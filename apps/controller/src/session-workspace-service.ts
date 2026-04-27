import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const safeWorkspaceSessionIdPattern = /^ses_[a-z0-9]+$/;

export interface CreateSessionWorkspaceServiceOptions {
  readonly baseDirectory: string;
}

export interface SessionWorkspaceMetadata {
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly exists: boolean;
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly sizeBytes: number;
  readonly updatedAt: string | null;
}

export interface SessionWorkspaceService {
  readonly baseDirectory: string;
  getWorkspacePath(sessionId: string): string;
  ensureWorkspace(sessionId: string): Promise<string>;
  deleteWorkspace(sessionId: string): Promise<void>;
  listWorkspaceMetadata(sessionId: string): Promise<SessionWorkspaceMetadata>;
}

export function createSessionWorkspaceService(
  options: CreateSessionWorkspaceServiceOptions
): SessionWorkspaceService {
  const baseDirectory = resolve(options.baseDirectory);

  function getWorkspacePath(sessionId: string): string {
    assertValidWorkspaceSessionId(sessionId);

    const workspacePath = resolve(baseDirectory, sessionId, "workspace");
    assertPathInsideBase(workspacePath, baseDirectory);

    return workspacePath;
  }

  return {
    baseDirectory,

    getWorkspacePath,

    async ensureWorkspace(sessionId) {
      const workspacePath = getWorkspacePath(sessionId);
      await mkdir(workspacePath, { recursive: true, mode: 0o700 });
      return workspacePath;
    },

    async deleteWorkspace(sessionId) {
      const workspacePath = getWorkspacePath(sessionId);
      assertPathInsideBase(workspacePath, baseDirectory);
      await rm(workspacePath, { recursive: true, force: true });
    },

    async listWorkspaceMetadata(sessionId) {
      const workspacePath = getWorkspacePath(sessionId);
      const metadata = await collectWorkspaceMetadata(workspacePath);

      return {
        sessionId,
        workspacePath,
        ...metadata
      };
    }
  };
}

export function assertValidWorkspaceSessionId(sessionId: string): void {
  if (!safeWorkspaceSessionIdPattern.test(sessionId)) {
    throw new Error(
      `Invalid session workspace ID: ${JSON.stringify(sessionId)}. Expected a Monet session ID matching /^ses_[a-z0-9]+$/.`
    );
  }
}

async function collectWorkspaceMetadata(workspacePath: string): Promise<
  Pick<SessionWorkspaceMetadata, "exists" | "fileCount" | "directoryCount" | "sizeBytes" | "updatedAt">
> {
  let workspaceStats: Awaited<ReturnType<typeof stat>>;

  try {
    workspaceStats = await stat(workspacePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        exists: false,
        fileCount: 0,
        directoryCount: 0,
        sizeBytes: 0,
        updatedAt: null
      };
    }

    throw error;
  }

  if (!workspaceStats.isDirectory()) {
    return {
      exists: true,
      fileCount: 1,
      directoryCount: 0,
      sizeBytes: workspaceStats.size,
      updatedAt: workspaceStats.mtime.toISOString()
    };
  }

  const totals = await collectDirectoryTotals(workspacePath);

  return {
    exists: true,
    ...totals,
    updatedAt: workspaceStats.mtime.toISOString()
  };
}

async function collectDirectoryTotals(directoryPath: string): Promise<
  Pick<SessionWorkspaceMetadata, "fileCount" | "directoryCount" | "sizeBytes">
> {
  let fileCount = 0;
  let directoryCount = 0;
  let sizeBytes = 0;

  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      directoryCount += 1;
      const childTotals = await collectDirectoryTotals(entryPath);
      fileCount += childTotals.fileCount;
      directoryCount += childTotals.directoryCount;
      sizeBytes += childTotals.sizeBytes;
      continue;
    }

    const entryStats = await stat(entryPath);
    fileCount += 1;
    sizeBytes += entryStats.size;
  }

  return { fileCount, directoryCount, sizeBytes };
}

function assertPathInsideBase(targetPath: string, baseDirectory: string): void {
  const relativePath = relative(baseDirectory, targetPath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to use session workspace path outside configured base: ${targetPath}`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
