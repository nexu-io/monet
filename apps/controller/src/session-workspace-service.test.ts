import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { assertValidWorkspaceSessionId, createSessionWorkspaceService } from "./session-workspace-service";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "monet-session-workspace-test-"));
}

test("generates stable workspace paths beneath the configured base directory", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  const workspacePath = service.getWorkspacePath("ses_abc123");

  assert.equal(service.baseDirectory, resolve(baseDirectory));
  assert.equal(workspacePath, resolve(baseDirectory, "ses_abc123", "workspace"));
});

test("validates session IDs before using them as workspace path segments", () => {
  assert.doesNotThrow(() => assertValidWorkspaceSessionId("ses_abc123"));
  assert.doesNotThrow(() => assertValidWorkspaceSessionId("ses_0"));

  for (const sessionId of ["", "ses_", "abc123", "ses_ABC123", "ses_abc-123", "ses_../escape", "../ses_abc"]) {
    assert.throws(
      () => assertValidWorkspaceSessionId(sessionId),
      /Invalid session workspace ID: .* Expected a Monet session ID/
    );
  }
});

test("creates workspace directories lazily with restrictive permissions", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  const workspacePath = service.getWorkspacePath("ses_lazy123");

  await assert.rejects(access(workspacePath), /ENOENT/);

  const ensuredPath = await service.ensureWorkspace("ses_lazy123");
  assert.equal(ensuredPath, workspacePath);

  const workspaceStats = await stat(workspacePath);
  assert.equal(workspaceStats.isDirectory(), true);
  assert.equal(workspaceStats.mode & 0o777, 0o700);
});

test("ensureWorkspace refuses symlinked session directories escaping the base", async (t) => {
  const baseDirectory = await createTempDirectory();
  const outsideDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  await mkdir(join(outsideDirectory, "workspace"), { recursive: true });
  await writeFile(join(outsideDirectory, "workspace", "keep.txt"), "keep");
  await symlink(outsideDirectory, join(baseDirectory, "ses_escape1"), "dir");

  await assert.rejects(service.ensureWorkspace("ses_escape1"), /Refusing to use session workspace path outside configured base/);
  await access(join(outsideDirectory, "workspace", "keep.txt"));
});

test("reports metadata for absent and existing workspaces", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });

  assert.deepEqual(await service.listWorkspaceMetadata("ses_meta1"), {
    sessionId: "ses_meta1",
    workspacePath: service.getWorkspacePath("ses_meta1"),
    exists: false,
    fileCount: 0,
    directoryCount: 0,
    sizeBytes: 0,
    updatedAt: null
  });

  const workspacePath = await service.ensureWorkspace("ses_meta1");
  await writeFile(join(workspacePath, "hello.txt"), "hello");

  const metadata = await service.listWorkspaceMetadata("ses_meta1");
  assert.equal(metadata.exists, true);
  assert.equal(metadata.fileCount, 1);
  assert.equal(metadata.directoryCount, 0);
  assert.equal(metadata.sizeBytes, 5);
  assert.equal(typeof metadata.updatedAt, "string");
});

test("keeps workspace paths stable across service restarts", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const firstService = createSessionWorkspaceService({ baseDirectory });
  const firstPath = await firstService.ensureWorkspace("ses_restart1");

  const restartedService = createSessionWorkspaceService({ baseDirectory });
  const restartedPath = restartedService.getWorkspacePath("ses_restart1");

  assert.equal(restartedPath, firstPath);
  assert.equal(await restartedService.ensureWorkspace("ses_restart1"), firstPath);
});

test("deleteWorkspace refuses to recursively remove paths that escape the configured base", async (t) => {
  const baseDirectory = await createTempDirectory();
  const outsideDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  const escapedWorkspacePath = join(outsideDirectory, "workspace");
  await mkdir(escapedWorkspacePath, { recursive: true });
  await writeFile(join(escapedWorkspacePath, "keep.txt"), "keep");
  await symlink(outsideDirectory, join(baseDirectory, "ses_escape1"), "dir");

  await assert.rejects(
    service.deleteWorkspace("ses_escape1"),
    /Refusing to use session workspace path outside configured base/
  );
  await access(join(escapedWorkspacePath, "keep.txt"));
});

test("cleanupOrphanWorkspaces deletes inactive workspaces while preserving active session workspaces", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  const activeWorkspacePath = await service.ensureWorkspace("ses_active1");
  const orphanWorkspacePath = await service.ensureWorkspace("ses_orphan1");
  await writeFile(join(activeWorkspacePath, "keep.txt"), "keep");
  await writeFile(join(orphanWorkspacePath, "delete.txt"), "delete");

  const result = await service.cleanupOrphanWorkspaces({ activeSessionIds: ["ses_active1"] });

  assert.deepEqual(result, {
    scannedCount: 2,
    deletedCount: 1,
    skippedCount: 1
  });
  await access(join(activeWorkspacePath, "keep.txt"));
  await assert.rejects(access(orphanWorkspacePath), /ENOENT/);
});

test("cleanupOrphanWorkspaces re-checks active sessions before deletion", async (t) => {
  const baseDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  const activeWorkspacePath = await service.ensureWorkspace("ses_activenew");
  await writeFile(join(activeWorkspacePath, "keep.txt"), "keep");

  const result = await service.cleanupOrphanWorkspaces({
    activeSessionIds: [],
    isSessionActive(sessionId) {
      return sessionId === "ses_activenew";
    }
  });

  assert.deepEqual(result, {
    scannedCount: 1,
    deletedCount: 0,
    skippedCount: 1
  });
  await access(join(activeWorkspacePath, "keep.txt"));
});

test("cleanupOrphanWorkspaces conservatively skips unsafe or incomplete workspace entries", async (t) => {
  const baseDirectory = await createTempDirectory();
  const outsideDirectory = await createTempDirectory();
  t.after(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  });

  const service = createSessionWorkspaceService({ baseDirectory });
  await mkdir(join(baseDirectory, "ses_missingworkspace"), { recursive: true });
  await mkdir(join(baseDirectory, "invalid-session"), { recursive: true });
  await writeFile(join(baseDirectory, "not-a-session-directory"), "skip");
  await mkdir(join(baseDirectory, "ses_linked1"), { recursive: true });
  await mkdir(join(outsideDirectory, "workspace"), { recursive: true });
  await writeFile(join(outsideDirectory, "workspace", "keep.txt"), "keep");
  await symlink(join(outsideDirectory, "workspace"), join(baseDirectory, "ses_linked1", "workspace"), "dir");

  const result = await service.cleanupOrphanWorkspaces({ activeSessionIds: [] });

  assert.deepEqual(result, {
    scannedCount: 4,
    deletedCount: 0,
    skippedCount: 4
  });
  await access(join(baseDirectory, "ses_missingworkspace"));
  await access(join(baseDirectory, "invalid-session"));
  await access(join(baseDirectory, "not-a-session-directory"));
  await access(join(outsideDirectory, "workspace", "keep.txt"));
});
