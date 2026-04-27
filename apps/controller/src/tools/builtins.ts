import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "@hono/zod-openapi";

import type { RegisteredToolDefinition } from "./registry";

export interface BuiltinToolsOptions {
  readonly allowedDirectories: readonly string[];
  readonly getAllowedDirectories?: () => readonly string[];
  readonly getControllerPort?: () => number | undefined;
  readonly controllerPort?: number;
  readonly dnsLookup?: DnsLookupFn;
  readonly fetchUrlRequest?: FetchUrlRequestFn;
}

type DnsLookupFn = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
type ResolvedFetchUrlAddress = Pick<LookupAddress, "address" | "family">;

interface FetchUrlResponse {
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly content: string;
}

interface FetchUrlRequestOptions {
  readonly url: URL;
  readonly abortSignal: AbortSignal;
  readonly resolvedAddress: ResolvedFetchUrlAddress;
}

type FetchUrlRequestFn = (options: FetchUrlRequestOptions) => Promise<FetchUrlResponse>;
type FilesystemAccessMode = "read" | "write";
type FilesystemPathZone = "session_workspace" | "authorized_directory" | "denied";

interface ResolvedFilesystemPath {
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly zone: FilesystemPathZone;
  readonly requiresConfirmation: boolean;
}

interface ClassifyFilesystemPathOptions {
  readonly requestedPath: string;
  readonly accessMode: FilesystemAccessMode;
  readonly sessionWorkspacePath: string;
  readonly authorizedDirectories: readonly string[];
}

function assertFetchUrlContentWithinLimit(response: FetchUrlResponse, maxBytes: number) {
  const contentLength = response.headers.get("content-length");

  if (contentLength) {
    const parsedContentLength = Number.parseInt(contentLength, 10);

    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
      throw new Error(`fetch_url response exceeded the size limit of ${maxBytes} bytes.`);
    }
  }

  if (Buffer.byteLength(response.content, "utf8") > maxBytes) {
    throw new Error(`fetch_url response exceeded the size limit of ${maxBytes} bytes.`);
  }
}

interface FetchUrlInput {
  readonly url: string;
}

interface ReadFileInput {
  readonly path: string;
}

interface WriteFileInput {
  readonly path: string;
  readonly content: string;
}

const fetchUrlMaxRedirects = 3;
const fetchUrlMaxResponseBytes = 1_000_000;
const fetchUrlMaxReturnedContentBytes = 64 * 1024;
const readFileMaxBytes = 1_000_000;
const blockedIpAddresses = createBlockedIpAddresses();

function truncateUtf8Text(value: string, maxBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return {
      text: value,
      truncated: false,
      originalSizeBytes: Buffer.byteLength(value, "utf8")
    };
  }

  let end = Math.min(value.length, maxBytes);
  let text = value.slice(0, end);

  while (Buffer.byteLength(text, "utf8") > maxBytes && end > 0) {
    end -= 1;
    text = value.slice(0, end);
  }

  return {
    text,
    truncated: true,
    originalSizeBytes: Buffer.byteLength(value, "utf8")
  };
}

function assertReadFileWithinLimit(sizeBytes: number, maxBytes: number) {
  if (sizeBytes > maxBytes) {
    throw new Error(`read_file exceeded the size limit of ${maxBytes} bytes.`);
  }
}

function normalizeAllowedDirectories(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(path.trim())).filter(Boolean)));
}

function createBlockedIpAddresses() {
  const blockList = new BlockList();

  blockList.addSubnet("127.0.0.0", 8, "ipv4");
  blockList.addSubnet("10.0.0.0", 8, "ipv4");
  blockList.addSubnet("172.16.0.0", 12, "ipv4");
  blockList.addSubnet("192.168.0.0", 16, "ipv4");
  blockList.addSubnet("169.254.0.0", 16, "ipv4");

  blockList.addSubnet("::1", 128, "ipv6");
  blockList.addSubnet("fc00::", 7, "ipv6");
  blockList.addSubnet("fe80::", 10, "ipv6");
  blockList.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
  blockList.addSubnet("::ffff:10.0.0.0", 104, "ipv6");
  blockList.addSubnet("::ffff:172.16.0.0", 108, "ipv6");
  blockList.addSubnet("::ffff:192.168.0.0", 112, "ipv6");
  blockList.addSubnet("::ffff:169.254.0.0", 112, "ipv6");

  return blockList;
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  return normalizedHostname === "localhost" || normalizedHostname.endsWith(".localhost");
}

function isBlockedIpAddress(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  const family = isIP(normalizedHostname);

  if (family === 4) {
    return blockedIpAddresses.check(normalizedHostname, "ipv4");
  }

  if (family === 6) {
    return blockedIpAddresses.check(normalizedHostname, "ipv6");
  }

  return false;
}

function getNormalizedPort(parsedUrl: URL) {
  if (parsedUrl.port) {
    return Number.parseInt(parsedUrl.port, 10);
  }

  return parsedUrl.protocol === "https:" ? 443 : 80;
}

async function resolveFetchUrlTargetAddress(
  parsedUrl: URL,
  controllerPort: number | undefined,
  dnsLookup: DnsLookupFn
): Promise<ResolvedFetchUrlAddress> {
  if (parsedUrl.protocol !== "https:") {
    throw new Error("fetch_url only supports HTTPS URLs.");
  }

  const hostname = normalizeHostname(parsedUrl.hostname);

  if (!hostname) {
    throw new Error("fetch_url requires a hostname.");
  }

  const port = getNormalizedPort(parsedUrl);
  const isDirectlyBlocked = isLoopbackHostname(hostname) || isBlockedIpAddress(hostname);

  if (controllerPort !== undefined && port === controllerPort && isDirectlyBlocked) {
    throw new Error("fetch_url cannot access the local controller port.");
  }

  if (isDirectlyBlocked) {
    throw new Error("fetch_url blocks loopback, private, link-local, and metadata network destinations.");
  }

  const directFamily = isIP(hostname);

  if (directFamily !== 0) {
    return {
      address: hostname,
      family: directFamily
    };
  }

  const resolvedAddresses = await dnsLookup(hostname, { all: true, verbatim: true });

  if (resolvedAddresses.length === 0) {
    throw new Error("fetch_url could not resolve the target host.");
  }

  const blockedResolution = resolvedAddresses.find((address) => isBlockedIpAddress(address.address));

  if (!blockedResolution) {
    return resolvedAddresses[0]!;
  }

  if (controllerPort !== undefined && port === controllerPort) {
    throw new Error("fetch_url cannot access the local controller port.");
  }

  throw new Error("fetch_url blocks loopback, private, link-local, and metadata network destinations.");
}

async function readNodeResponseTextWithLimit(
  response: IncomingMessage,
  contentLengthHeader: string | null,
  maxBytes: number
) {
  if (contentLengthHeader) {
    const parsedContentLength = Number.parseInt(contentLengthHeader, 10);

    if (Number.isFinite(parsedContentLength) && parsedContentLength > maxBytes) {
      throw new Error(`fetch_url response exceeded the size limit of ${maxBytes} bytes.`);
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of response) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += chunkBuffer.byteLength;

    if (totalBytes > maxBytes) {
      response.destroy(new Error(`fetch_url response exceeded the size limit of ${maxBytes} bytes.`));
      throw new Error(`fetch_url response exceeded the size limit of ${maxBytes} bytes.`);
    }

    chunks.push(chunkBuffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function createHeadersFromNodeResponseHeaders(headers: Record<string, string | string[] | undefined>) {
  const normalizedHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        normalizedHeaders.append(name, entry);
      }

      continue;
    }

    normalizedHeaders.set(name, value);
  }

  return normalizedHeaders;
}

const defaultFetchUrlRequest: FetchUrlRequestFn = async ({ url, abortSignal, resolvedAddress }) =>
  new Promise((resolvePromise, rejectPromise) => {
    const requestOptions: RequestOptions = {
      protocol: "https:",
      hostname: url.hostname,
      port: getNormalizedPort(url),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      signal: abortSignal,
      servername: url.hostname,
      lookup: ((hostname, lookupOptions, callback) => {
        if (normalizeHostname(hostname) !== normalizeHostname(url.hostname)) {
          callback(new Error("fetch_url attempted to resolve an unexpected hostname."), "", 0);
          return;
        }

        if (typeof lookupOptions === "object" && lookupOptions !== null && "all" in lookupOptions && lookupOptions.all === true) {
          callback(null, [resolvedAddress]);
          return;
        }

        callback(null, resolvedAddress.address, resolvedAddress.family);
      }) as RequestOptions["lookup"]
    };

    const request = httpsRequest(requestOptions, async (response) => {
      try {
        const headers = createHeadersFromNodeResponseHeaders(response.headers);
        const content = await readNodeResponseTextWithLimit(
          response,
          headers.get("content-length"),
          fetchUrlMaxResponseBytes
        );

        resolvePromise({
          statusCode: response.statusCode ?? 0,
          statusText: response.statusMessage ?? "",
          headers,
          content
        });
      } catch (error) {
        rejectPromise(error);
      }
    });

    request.on("error", rejectPromise);
    request.end();
  });

function isRedirectResponse(statusCode: number) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function fetchUrlWithGuards(
  inputUrl: URL,
  abortSignal: AbortSignal,
  controllerPort: number | undefined,
  dnsLookup: DnsLookupFn,
  fetchUrlRequest: FetchUrlRequestFn
) {
  let currentUrl = inputUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const resolvedAddress = await resolveFetchUrlTargetAddress(currentUrl, controllerPort, dnsLookup);

    const response = await fetchUrlRequest({
      url: currentUrl,
      abortSignal,
      resolvedAddress
    });
    assertFetchUrlContentWithinLimit(response, fetchUrlMaxResponseBytes);

    if (!isRedirectResponse(response.statusCode)) {
      return {
        response,
        resolvedUrl: currentUrl.toString(),
        content: response.content
      };
    }

    if (redirectCount >= fetchUrlMaxRedirects) {
      throw new Error(`fetch_url exceeded the redirect limit of ${fetchUrlMaxRedirects}.`);
    }

    const location = response.headers.get("location");

    if (!location) {
      throw new Error("fetch_url received a redirect response without a Location header.");
    }

    currentUrl = new URL(location, currentUrl);
  }
}

function isWithinDirectory(parentPath: string, candidatePath: string) {
  const pathRelativeToParent = relative(parentPath, candidatePath);

  return pathRelativeToParent === "" || (!pathRelativeToParent.startsWith("..") && !isAbsolute(pathRelativeToParent));
}

async function getNearestExistingRealPath(targetPath: string) {
  let candidatePath = resolve(targetPath);

  while (true) {
    try {
      const candidateStat = await lstat(candidatePath);

      return {
        existingPath: candidatePath,
        realPath: await realpath(candidatePath),
        isDirectory: candidateStat.isDirectory()
      };
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }

    const parentPath = dirname(candidatePath);

    if (parentPath === candidatePath) {
      throw new Error("Path is outside the authorized directories.");
    }

    candidatePath = parentPath;
  }
}

async function getAuthorizedDirectoriesRealPaths(allowedDirectories: readonly string[]) {
  const settledDirectories = await Promise.allSettled(
    allowedDirectories.map(async (directory) => ({
      directory,
      realPath: await realpath(directory)
    }))
  );

  return settledDirectories.flatMap((result) => (result.status === "fulfilled" ? [result.value.realPath] : []));
}

async function getCanonicalPathForAccess(targetPath: string, accessMode: FilesystemAccessMode) {
  const resolvedPath = resolve(targetPath);
  const existingPath = await getNearestExistingRealPath(resolvedPath);

  if (accessMode === "read" || existingPath.existingPath === resolvedPath) {
    return existingPath.realPath;
  }

  return resolve(existingPath.realPath, relative(existingPath.existingPath, resolvedPath));
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function classifyFilesystemPath(options: ClassifyFilesystemPathOptions): Promise<ResolvedFilesystemPath> {
  const normalizedInputPath = options.requestedPath.trim();

  if (!normalizedInputPath) {
    throw new Error("Path is required.");
  }

  const [sessionWorkspacePath, authorizedDirectories] = await Promise.all([
    realpath(options.sessionWorkspacePath),
    getAuthorizedDirectoriesRealPaths(options.authorizedDirectories)
  ]);

  const resolvedPath = isAbsolute(normalizedInputPath)
    ? resolve(normalizedInputPath)
    : resolve(sessionWorkspacePath, normalizedInputPath);
  const candidatePath = await getCanonicalPathForAccess(resolvedPath, options.accessMode);

  if (isWithinDirectory(sessionWorkspacePath, candidatePath)) {
    return {
      requestedPath: options.requestedPath,
      resolvedPath: candidatePath,
      zone: "session_workspace",
      requiresConfirmation: false
    };
  }

  const matchingAuthorizedDirectory = authorizedDirectories.find((directory) => isWithinDirectory(directory, candidatePath));

  if (matchingAuthorizedDirectory) {
    return {
      requestedPath: options.requestedPath,
      resolvedPath: candidatePath,
      zone: "authorized_directory",
      requiresConfirmation: options.accessMode === "write"
    };
  }

  return {
    requestedPath: options.requestedPath,
    resolvedPath: candidatePath,
    zone: "denied",
    requiresConfirmation: false
  };
}

async function assertFilesystemPathAllowed(options: ClassifyFilesystemPathOptions) {
  const resolvedPath = await classifyFilesystemPath(options);

  if (resolvedPath.zone === "denied") {
    throw new Error("Path is outside the authorized directories or session workspace.");
  }

  return resolvedPath;
}

export function createBuiltinToolDefinitions(
  options: BuiltinToolsOptions
): ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> {
  const dnsLookup = options.dnsLookup ?? lookup;
  const fetchUrlRequest = options.fetchUrlRequest ?? defaultFetchUrlRequest;
  const getAllowedDirectories = () =>
    normalizeAllowedDirectories(options.getAllowedDirectories ? options.getAllowedDirectories() : options.allowedDirectories);
  const getControllerPort = () => options.getControllerPort?.() ?? options.controllerPort;

  return [
    {
      metadata: {
        name: "fetch_url",
        description: "Fetches an HTTPS URL and returns the text response body.",
        requiresConfirmation: false
      },
      inputSchema: z.object({
        url: z.string()
      }).strict(),
      async execute(input, context) {
        const normalizedInput = input as FetchUrlInput;
        const parsedUrl = new URL(normalizedInput.url);
        const { response, resolvedUrl, content } = await fetchUrlWithGuards(
          parsedUrl,
          context.abortSignal,
          getControllerPort(),
          dnsLookup,
          fetchUrlRequest
        );

        const returnedContent = truncateUtf8Text(content, fetchUrlMaxReturnedContentBytes);

        return {
          url: resolvedUrl,
          statusCode: response.statusCode,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          content: returnedContent.text,
          contentTruncated: returnedContent.truncated,
          contentSizeBytes: returnedContent.originalSizeBytes
        };
      }
    },
    {
      metadata: {
        name: "read_file",
        description: "Reads a UTF-8 text file from an authorized directory.",
        requiresConfirmation: false
      },
      inputSchema: z.object({
        path: z.string()
      }).strict(),
      async execute(input, context) {
        const normalizedInput = input as ReadFileInput;
        const resolvedPath = await assertFilesystemPathAllowed({
          requestedPath: normalizedInput.path,
          accessMode: "read",
          sessionWorkspacePath: context.sessionWorkspacePath,
          authorizedDirectories: getAllowedDirectories()
        });
        const fileStat = await stat(resolvedPath.resolvedPath);
        assertReadFileWithinLimit(fileStat.size, readFileMaxBytes);
        const content = await readFile(resolvedPath.resolvedPath, "utf8");

        return {
          path: resolvedPath.resolvedPath,
          content,
          sizeBytes: fileStat.size
        };
      }
    },
    {
      metadata: {
        name: "write_file",
        description: "Writes a UTF-8 text file inside an authorized directory.",
        requiresConfirmation: true
      },
      inputSchema: z.object({
        path: z.string(),
        content: z.string()
      }).strict(),
      async execute(input, context) {
        const normalizedInput = input as WriteFileInput;
        const resolvedPath = await assertFilesystemPathAllowed({
          requestedPath: normalizedInput.path,
          accessMode: "write",
          sessionWorkspacePath: context.sessionWorkspacePath,
          authorizedDirectories: getAllowedDirectories()
        });

        await mkdir(dirname(resolvedPath.resolvedPath), { recursive: true });
        await writeFile(resolvedPath.resolvedPath, normalizedInput.content, "utf8");

        return {
          path: resolvedPath.resolvedPath,
          bytesWritten: Buffer.byteLength(normalizedInput.content, "utf8")
        };
      }
    }
  ];
}
