import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RegisteredToolDefinition } from "./registry";

export interface BuiltinToolsOptions {
  readonly allowedDirectories: readonly string[];
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

function normalizeAllowedDirectories(paths: readonly string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(path.trim())).filter(Boolean)));
}

function isWithinDirectory(parentPath: string, candidatePath: string) {
  const pathRelativeToParent = relative(parentPath, candidatePath);

  return pathRelativeToParent === "" || (!pathRelativeToParent.startsWith("..") && !isAbsolute(pathRelativeToParent));
}

function resolveAuthorizedPath(inputPath: string, allowedDirectories: readonly string[]) {
  const normalizedInputPath = inputPath.trim();

  if (!normalizedInputPath) {
    throw new Error("Path is required.");
  }

  const resolvedPath = resolve(normalizedInputPath);
  const matchingDirectory = allowedDirectories.find((directory) => isWithinDirectory(directory, resolvedPath));

  if (!matchingDirectory) {
    throw new Error("Path is outside the authorized directories.");
  }

  return resolvedPath;
}

export function createBuiltinToolDefinitions(
  options: BuiltinToolsOptions
): ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> {
  const allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);

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

        if (parsedUrl.protocol !== "https:") {
          throw new Error("fetch_url only supports HTTPS URLs.");
        }

        const response = await fetch(parsedUrl, {
          signal: context.abortSignal
        });
        const content = await response.text();

        return {
          url: response.url,
          statusCode: response.status,
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
        const authorizedPath = resolveAuthorizedPath(normalizedInput.path, allowedDirectories);
        const [content, fileStat] = await Promise.all([readFile(authorizedPath, "utf8"), stat(authorizedPath)]);

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
        const authorizedPath = resolveAuthorizedPath(normalizedInput.path, allowedDirectories);

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
