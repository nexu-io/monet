import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createControllerApp } from "./app";
import { createChatStorage } from "./chat-storage";
import { createLogger } from "./logger";

function createAppFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-app-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const defaultDir = join(fixtureDir, "default-workspace");
  const persistedDir = join(fixtureDir, "persisted-workspace");

  mkdirSync(defaultDir, { recursive: true });
  mkdirSync(persistedDir, { recursive: true });

  return {
    databasePath,
    defaultDir,
    persistedDir,
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

function createControllerAppOptions(fixture: ReturnType<typeof createAppFixture>, connectors: boolean) {
  return {
    allowedOrigins: ["null"],
    allowedToolDirectories: [fixture.defaultDir],
    allowedToolDirectoriesSource: "default" as const,
    agentRuntime: {
      maxStepsPerRun: 8,
      maxTokensPerRun: 32_768,
      wallClockBudgetMs: 60_000,
      maxToolCallsPerRun: 16
    },
    bearerToken: "test-token",
    connectorProvider: {
      provider: "composio" as const,
      composio: {
        apiKey: null,
        baseUrl: "https://backend.composio.dev",
        timeoutMs: null,
        authConfigIds: {}
      }
    },
    databasePath: fixture.databasePath,
    features: {
      connectors
    },
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
  };
}

test("controller app keeps persisted authorized directories when env uses default source", () => {
  const fixture = createAppFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.persistedDir]);

    createControllerApp(createControllerAppOptions(fixture, false));

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(
      reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path),
      [resolve(fixture.persistedDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("controller app returns 404 for connector routes when connectors feature is disabled", async () => {
  const fixture = createAppFixture();

  try {
    const { app } = createControllerApp(createControllerAppOptions(fixture, false));
    const cases = [
      { method: "GET", path: "/api/connectors" },
      { method: "GET", path: "/api/connectors/github" },
      { method: "POST", path: "/api/connectors/github/connect" },
      { method: "DELETE", path: "/api/connectors/github/connection" },
      { method: "GET", path: "/connectors/oauth/callback/composio" }
    ] as const;

    for (const { method, path } of cases) {
      const response = await app.request(`http://127.0.0.1:42831${path}`, {
        method,
        headers: {
          authorization: "Bearer test-token"
        }
      });

      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(
        await response.json(),
        {
          error: "not_found",
          message: "Route not found."
        },
        `${method} ${path}`
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("controller app excludes ConnectorToolSource from chat runtime tools when connectors feature is disabled", async () => {
  const fixture = createAppFixture();

  try {
    const runtime = createControllerApp(createControllerAppOptions(fixture, false));

    const runtimeTools = await runtime.toolRegistry.createRuntimeTools({
      runId: "run_disabled_connectors",
      chatStorage: runtime.chatStorage,
      logger: createLogger("test"),
      abortSignal: new AbortController().signal
    });

    assert.equal(
      Object.keys(runtimeTools).some((toolName) => /^(github|notion|google_drive)_/.test(toolName)),
      false
    );
  } finally {
    fixture.cleanup();
  }
});
