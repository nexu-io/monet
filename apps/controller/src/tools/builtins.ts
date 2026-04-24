import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RegisteredToolDefinition } from "./registry";

export interface BuiltinToolsOptions {
  readonly allowedDirectories: readonly string[];
  readonly getAllowedDirectories?: () => readonly string[];
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
const readFileMaxBytes = 1_000_000;
const blockedIpAddresses = createBlockedIpAddresses();

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
      lookup: ((hostname, _options, callback) => {
        if (normalizeHostname(hostname) !== normalizeHostname(url.hostname)) {
          callback(new Error("fetch_url attempted to resolve an unexpected hostname."), "", 0);
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

async function getExistingRealPath(targetPath: string) {
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

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function resolveAuthorizedPath(inputPath: string, allowedDirectories: readonly string[], accessMode: "read" | "write") {
  const normalizedInputPath = inputPath.trim();

  if (!normalizedInputPath) {
    throw new Error("Path is required.");
  }

  const resolvedPath = resolve(normalizedInputPath);
  const authorizedDirectories = await getAuthorizedDirectoriesRealPaths(allowedDirectories);

  if (authorizedDirectories.length === 0) {
    throw new Error("No authorized directories are currently available.");
  }

  const existingPath = await getExistingRealPath(resolvedPath);
  const candidatePath =
    accessMode === "read" || existingPath.existingPath === resolvedPath
      ? existingPath.realPath
      : resolve(existingPath.realPath, relative(existingPath.existingPath, resolvedPath));
  const matchingDirectory = authorizedDirectories.find((directory) => isWithinDirectory(directory, candidatePath));

  if (!matchingDirectory) {
    throw new Error("Path is outside the authorized directories.");
  }

  return candidatePath;
}

export function createBuiltinToolDefinitions(
  options: BuiltinToolsOptions
): ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> {
  const dnsLookup = options.dnsLookup ?? lookup;
  const fetchUrlRequest = options.fetchUrlRequest ?? defaultFetchUrlRequest;
  const getAllowedDirectories = () =>
    normalizeAllowedDirectories(options.getAllowedDirectories ? options.getAllowedDirectories() : options.allowedDirectories);

  return [
    {
      metadata: {
        name: "fetch_url",
        description: "Fetches an HTTPS URL and returns the text response body.",
        requiresConfirmation: false
      },
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" }
        },
        required: ["url"],
        additionalProperties: false
      } as const,
      async execute(input, context) {
        const normalizedInput = input as FetchUrlInput;
        const parsedUrl = new URL(normalizedInput.url);
        const { response, resolvedUrl, content } = await fetchUrlWithGuards(
          parsedUrl,
          context.abortSignal,
          options.controllerPort,
          dnsLookup,
          fetchUrlRequest
        );

        return {
          url: resolvedUrl,
          statusCode: response.statusCode,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          content
        };
      }
    },
    {
      metadata: {
        name: "read_file",
        description: "Reads a UTF-8 text file from an authorized directory.",
        requiresConfirmation: false
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      } as const,
      async execute(input) {
        const normalizedInput = input as ReadFileInput;
        const authorizedPath = await resolveAuthorizedPath(normalizedInput.path, getAllowedDirectories(), "read");
        const fileStat = await stat(authorizedPath);
        assertReadFileWithinLimit(fileStat.size, readFileMaxBytes);
        const content = await readFile(authorizedPath, "utf8");

        return {
          path: authorizedPath,
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
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"],
        additionalProperties: false
      } as const,
      async execute(input) {
        const normalizedInput = input as WriteFileInput;
        const authorizedPath = await resolveAuthorizedPath(normalizedInput.path, getAllowedDirectories(), "write");

        await mkdir(dirname(authorizedPath), { recursive: true });
        await writeFile(authorizedPath, normalizedInput.content, "utf8");

        return {
          path: authorizedPath,
          bytesWritten: Buffer.byteLength(normalizedInput.content, "utf8")
        };
      }
    }
  ];
}
