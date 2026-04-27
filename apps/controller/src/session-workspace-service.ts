import { chmod, lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { Logger } from "./logger";

const safeWorkspaceSessionIdPattern = /^ses_[a-z0-9]+$/;
const workspaceDirectoryMode = 0o700;

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

export interface CleanupOrphanWorkspacesResult {
  readonly scannedCount: number;
  readonly deletedCount: number;
  readonly skippedCount: number;
}

export interface CleanupOrphanWorkspacesOptions {
  readonly activeSessionIds: readonly string[];
  readonly logger?: Pick<Logger, "debug" | "info" | "warn">;
}

export interface SessionWorkspaceService {
  readonly baseDirectory: string;
  getWorkspacePath(sessionId: string): string;
  ensureWorkspace(sessionId: string): Promise<string>;
  deleteWorkspace(sessionId: string): Promise<void>;
  cleanupOrphanWorkspaces(options: CleanupOrphanWorkspacesOptions): Promise<CleanupOrphanWorkspacesResult>;
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
      await mkdir(workspacePath, { recursive: true, mode: workspaceDirectoryMode });
      await applyRestrictiveDirectoryPermissions(workspacePath);
      return workspacePath;
    },

    async deleteWorkspace(sessionId) {
      const workspacePath = await getVerifiedWorkspaceDeletionTarget(sessionId, getWorkspacePath, baseDirectory);

      if (workspacePath === null) {
        return;
      }

      await rm(workspacePath, { recursive: true, force: true });
    },

    async cleanupOrphanWorkspaces({ activeSessionIds, logger }) {
      const activeSessionIdSet = new Set(activeSessionIds);
      let scannedCount = 0;
      let deletedCount = 0;
      let skippedCount = 0;

      let entries: Dirent[];
      try {
        entries = await readdir(baseDirectory, { withFileTypes: true });
      } catch (error) {
        if (isNotFoundError(error)) {
          logger?.info("session_workspaces.orphan_cleanup_skipped", {
            baseDirectory,
            reason: "base_directory_missing"
          });
          return { scannedCount, deletedCount, skippedCount };
        }

        throw error;
      }

      for (const entry of entries) {
        scannedCount += 1;
        const sessionId = entry.name;
        const sessionDirectory = join(baseDirectory, sessionId);

        if (!entry.isDirectory()) {
          skippedCount += 1;
          logger?.debug("session_workspaces.orphan_cleanup_skipped_entry", {
            sessionDirectory,
            reason: "not_directory"
          });
          continue;
        }

        if (!safeWorkspaceSessionIdPattern.test(sessionId)) {
          skippedCount += 1;
          logger?.warn("session_workspaces.orphan_cleanup_skipped_entry", {
            sessionDirectory,
            reason: "invalid_session_directory_name"
          });
          continue;
        }

        if (activeSessionIdSet.has(sessionId)) {
          skippedCount += 1;
          logger?.debug("session_workspaces.orphan_cleanup_skipped_entry", {
            sessionId,
            sessionDirectory,
            reason: "active_session"
          });
          continue;
        }

        const workspacePath = await getConservativeOrphanWorkspaceDeletionTarget(sessionId, getWorkspacePath, baseDirectory);

        if (workspacePath === null) {
          skippedCount += 1;
          logger?.warn("session_workspaces.orphan_cleanup_skipped_entry", {
            sessionId,
            sessionDirectory,
            reason: "workspace_missing_or_not_plain_directory"
          });
          continue;
        }

        await rm(workspacePath, { recursive: true, force: true });
        deletedCount += 1;
        logger?.info("session_workspaces.orphan_cleanup_deleted", {
          sessionId,
          workspacePath
        });
      }

      logger?.info("session_workspaces.orphan_cleanup_completed", {
        baseDirectory,
        scannedCount,
        deletedCount,
        skippedCount
      });

      return { scannedCount, deletedCount, skippedCount };
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

async function getConservativeOrphanWorkspaceDeletionTarget(
  sessionId: string,
  getWorkspacePath: (sessionId: string) => string,
  baseDirectory: string
): Promise<string | null> {
  const workspacePath = getWorkspacePath(sessionId);
  assertPathInsideBase(workspacePath, baseDirectory);

  let workspaceStats: Awaited<ReturnType<typeof lstat>>;
  try {
    workspaceStats = await lstat(workspacePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
    return null;
  }

  const canonicalWorkspacePath = await realpath(workspacePath);
  const canonicalBaseDirectory = await realpath(baseDirectory);
  assertPathInsideBase(canonicalWorkspacePath, canonicalBaseDirectory);

  return workspacePath;
}

async function getVerifiedWorkspaceDeletionTarget(
  sessionId: string,
  getWorkspacePath: (sessionId: string) => string,
  baseDirectory: string
): Promise<string | null> {
  const workspacePath = getWorkspacePath(sessionId);
  assertPathInsideBase(workspacePath, baseDirectory);

  let canonicalWorkspacePath: string;
  try {
    canonicalWorkspacePath = await realpath(workspacePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  const canonicalBaseDirectory = await realpath(baseDirectory);
  assertPathInsideBase(canonicalWorkspacePath, canonicalBaseDirectory);

  return canonicalWorkspacePath;
}

async function applyRestrictiveDirectoryPermissions(workspacePath: string): Promise<void> {
  try {
    await chmod(workspacePath, workspaceDirectoryMode);
  } catch (error) {
    if (isUnsupportedChmodError(error)) {
      return;
    }

    throw error;
  }
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

function isUnsupportedChmodError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === "ENOSYS" || error.code === "ENOTSUP" || error.code === "EOPNOTSUPP";
}
