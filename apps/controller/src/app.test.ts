import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createControllerApp } from "./app";
import { createChatStorage } from "./chat-storage";
import { createSessionWorkspaceService } from "./session-workspace-service";

function createAppFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-app-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const defaultDir = join(fixtureDir, "default-workspace");
  const persistedDir = join(fixtureDir, "persisted-workspace");
  const sessionWorkspaceBaseDirectory = join(fixtureDir, "session-workspaces");

  mkdirSync(defaultDir, { recursive: true });
  mkdirSync(persistedDir, { recursive: true });

  return {
    databasePath,
    defaultDir,
    persistedDir,
    sessionWorkspaceBaseDirectory,
    fixtureDir,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function createStorage(databasePath: string) {
  return createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    }
  });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(condition(), true);
}

const testControllerOptions = {
  allowedOrigins: ["null"],
  agentRuntime: {
    maxStepsPerRun: 8,
    maxTokensPerRun: 32_768,
    wallClockBudgetMs: 60_000,
    maxToolCallsPerRun: 16
  },
  bearerToken: "test-token",
  openai: {
    apiKey: null,
    baseUrl: null,
    defaultModel: "gpt-4.1-mini",
    timeoutMs: null
  },
  openrouter: {
    apiKey: null,
    baseUrl: null,
    defaultModel: "openai/gpt-4.1-mini",
    timeoutMs: null
  },
  port: 42831
} as const;

test("controller app keeps persisted authorized directories when env uses default source", () => {
  const fixture = createAppFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.persistedDir]);

    createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [fixture.defaultDir],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(
      reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path),
      [resolve(fixture.persistedDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("controller startup orphan cleanup deletes inactive workspaces and preserves active sessions", async () => {
  const fixture = createAppFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const activeSession = storage.createSession({});
    const sessionWorkspaceService = createSessionWorkspaceService({
      baseDirectory: fixture.sessionWorkspaceBaseDirectory
    });
    const activeWorkspacePath = await sessionWorkspaceService.ensureWorkspace(activeSession.id);
    const orphanWorkspacePath = await sessionWorkspaceService.ensureWorkspace("ses_orphanstartup1");
    writeFileSync(join(activeWorkspacePath, "keep.txt"), "keep");
    writeFileSync(join(orphanWorkspacePath, "delete.txt"), "delete");

    createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [fixture.defaultDir],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });

    await waitForCondition(() => !existsSync(orphanWorkspacePath));
    assert.equal(existsSync(join(activeWorkspacePath, "keep.txt")), true);
  } finally {
    fixture.cleanup();
  }
});
