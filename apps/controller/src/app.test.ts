import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createControllerApp } from "./app";
import { createControllerConfig } from "./config";
import { createChatStorage } from "./chat-storage";
import { createLogger } from "./logger";
import { createSessionWorkspaceService } from "./session-workspace-service";
import { hashConnectorOAuthState } from "./connectors/oauth-state";

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

function createControllerAppOptions(
  fixture: ReturnType<typeof createAppFixture>,
  options: Partial<{
    allowedToolDirectories: readonly string[];
    allowedToolDirectoriesSource: "default" | "env";
  }> = {}
) {
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
        apiKey: "dummy-connectors-api-key",
        baseUrl: "https://backend.composio.dev",
        timeoutMs: null,
        authConfigIds: {
          github: "github",
          notion: "notion",
          google_drive: "google_drive"
        }
      }
    },
    databasePath: fixture.databasePath,
    openai: {
      apiKey: null,
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      apiUrl: null,
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    },
    openrouterApiKey: null,
    port: 42831,
    sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory,
    ...options
  };
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
  connectorProvider: {
    provider: "composio" as const,
    composio: {
      apiKey: "dummy-connectors-api-key",
      baseUrl: "https://backend.composio.dev",
      timeoutMs: null,
      authConfigIds: {
        github: "github",
        notion: "notion",
        google_drive: "google_drive"
      }
    }
  },
  openai: {
    apiKey: null,
    baseUrl: null,
    defaultModel: "gpt-4.1-mini",
    timeoutMs: null
  },
  openrouter: {
    apiUrl: null,
    baseUrl: null,
    defaultModel: "openai/gpt-4.1-mini",
    timeoutMs: null
  },
  openrouterApiKey: null,
  port: 42831
} as const;

const authorizedRequestHeaders = {
  Authorization: `Bearer ${testControllerOptions.bearerToken}`,
  Host: `127.0.0.1:${testControllerOptions.port}`
} as const;

test("controller app keeps persisted authorized directories when env uses default source", () => {
  const fixture = createAppFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.persistedDir]);

    createControllerApp(createControllerAppOptions(fixture));

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(
      reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path),
      [resolve(fixture.persistedDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("controller app exposes persisted authorized directories when default allowlist is empty", async () => {
  const fixture = createAppFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.persistedDir]);

    const runtime = createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });

    const response = await runtime.app.request(
      "http://127.0.0.1:42831/api/settings/authorized-directories",
      {
        headers: authorizedRequestHeaders
      }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json() as { authorizedDirectories: readonly { path: string }[] }).authorizedDirectories.map((entry) => entry.path),
      [resolve(fixture.persistedDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("controller app honors MONET_TOOL_ALLOWED_DIRECTORIES over persisted authorized directories", async () => {
  const fixture = createAppFixture();
  const envDir = join(fixture.fixtureDir, "env-workspace");
  const secondEnvDir = join(fixture.fixtureDir, "second-env-workspace");
  mkdirSync(envDir, { recursive: true });
  mkdirSync(secondEnvDir, { recursive: true });

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.persistedDir]);
    const config = createControllerConfig({
      MONET_CONTROLLER_BEARER_TOKEN: testControllerOptions.bearerToken,
      MONET_DATABASE_PATH: fixture.databasePath,
      MONET_SESSION_WORKSPACE_DIR: fixture.sessionWorkspaceBaseDirectory,
      MONET_TOOL_ALLOWED_DIRECTORIES: `${envDir}, ${secondEnvDir}, ${envDir}`
    });

    const runtime = createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: config.allowedToolDirectories,
      allowedToolDirectoriesSource: config.allowedToolDirectoriesSource,
      databasePath: config.databasePath,
      sessionWorkspaceBaseDirectory: config.sessionWorkspaceBaseDirectory
    });
    const response = await runtime.app.request(
      "http://127.0.0.1:42831/api/settings/authorized-directories",
      {
        headers: authorizedRequestHeaders
      }
    );

    const reopenedStorage = createStorage(fixture.databasePath);
    const expectedDirectories = [resolve(envDir), resolve(secondEnvDir)];

    assert.equal(config.allowedToolDirectoriesSource, "env");
    assert.deepEqual(config.allowedToolDirectories, expectedDirectories);
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json() as { authorizedDirectories: readonly { path: string }[] }).authorizedDirectories.map((entry) => entry.path),
      expectedDirectories
    );
    assert.deepEqual(reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path), expectedDirectories);
  } finally {
    fixture.cleanup();
  }
});

test("controller app exposes connectors API routes", async () => {
  const fixture = createAppFixture();

  try {
    const { app } = createControllerApp(createControllerAppOptions(fixture));
    const response = await app.request("http://127.0.0.1:42831/api/connectors", {
      method: "GET",
      headers: {
        Authorization: "Bearer test-token",
        Host: "127.0.0.1:42831"
      }
    });

    assert.equal(response.status, 200, "/api/connectors");
    assert.equal(
      Array.isArray((await response.json() as { readonly connectors: unknown[] }).connectors),
      true,
      "connectors response"
    );
  } finally {
    fixture.cleanup();
  }
});

test("controller app auto-discovers Composio auth config IDs when settings are saved", async (t) => {
  const fixture = createAppFixture();
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://composio.test/api/v3/auth_configs");
    assert.equal((init?.headers as Record<string, string> | undefined)?.["x-api-key"], "test-composio-api-key");

    return new Response(
      JSON.stringify({
        items: [
          { id: "ac_github", status: "ENABLED", toolkit: { slug: "github" } },
          { id: "ac_notion", status: "ENABLED", toolkit: { slug: "notion" } },
          { id: "ac_drive", status: "ENABLED", toolkit: { slug: "googledrive" } },
          { id: "ac_disabled", status: "DISABLED", toolkit: { slug: "github" } }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });

  try {
    const { app } = createControllerApp(createControllerAppOptions(fixture));
    const response = await app.request("http://127.0.0.1:42831/api/settings/connectors/composio", {
      method: "PUT",
      headers: {
        ...authorizedRequestHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        apiKey: "test-composio-api-key",
        baseUrl: "https://composio.test"
      })
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { authConfigIds: Record<string, string> }).authConfigIds, {
      github: "ac_github",
      notion: "ac_notion",
      google_drive: "ac_drive"
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  } finally {
    fixture.cleanup();
  }
});

test("controller app includes ConnectorToolSource in chat runtime tools", async () => {
  const fixture = createAppFixture();

  try {
    const runtime = createControllerApp(createControllerAppOptions(fixture));
    const userId = runtime.chatStorage.getMonetInstallId();
    runtime.chatStorage.replaceConnectorProviderComposioSettings({
      apiKey: "dummy-connectors-api-key",
      authConfigIds: {
        github: "github"
      }
    });
    const connectorOauthState = runtime.chatStorage.createConnectorOAuthState({
      stateHash: hashConnectorOAuthState("test-connection-state"),
      userId,
      connectorId: "github",
      provider: "composio",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });

    runtime.chatStorage.completeConnectorOAuthConnection({
      oauthStateId: connectorOauthState.id,
      userId,
      connectorId: "github",
      provider: "composio",
      providerConnectionId: "conn_test_github",
      providerMetadataJson: null,
      accountLabel: "octocat@example.com",
      status: "connected",
      lastConnectedAt: new Date().toISOString(),
      lastError: null
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, options) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(input);

      if (url.hostname === "backend.composio.dev" && url.pathname === "/api/v3.1/tools") {
        return new Response(
          JSON.stringify({
            items: [
              {
                slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
                toolkit: { slug: "GITHUB" },
                description: "List repositories"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return originalFetch(input, options);
    }) as typeof globalThis.fetch;

    try {
      const runtimeTools = await runtime.toolRegistry.createRuntimeTools({
        runId: "run_connectors_enabled",
        sessionId: "run_connectors_enabled_session",
        sessionWorkspacePath: join(fixture.sessionWorkspaceBaseDirectory, "run_connectors_enabled_session", "workspace"),
        chatStorage: runtime.chatStorage,
        logger: createLogger("test"),
        abortSignal: new AbortController().signal
      });

      assert.equal(
        Object.keys(runtimeTools).some((toolName) => /^github_/.test(toolName)),
        true
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    fixture.cleanup();
  }
});

test("controller app persists an empty authorized directory list when defaults are empty", () => {
  const fixture = createAppFixture();

  try {
    createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(reopenedStorage.listAuthorizedDirectories(), []);
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

test("controller app restart keeps existing session workspace paths stable", async () => {
  const fixture = createAppFixture();

  try {
    const firstRuntime = createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });
    const session = firstRuntime.chatStorage.createSession({});
    const firstOpenResponse = await firstRuntime.app.request(
      `http://127.0.0.1:42831/api/sessions/${session.id}/workspace/open`,
      {
        method: "POST",
        headers: authorizedRequestHeaders
      }
    );

    assert.equal(firstOpenResponse.status, 200);

    const firstWorkspacePath = (await firstOpenResponse.json() as { workspacePath: string }).workspacePath;
    writeFileSync(join(firstWorkspacePath, "before-restart.txt"), "keep");

    const restartedRuntime = createControllerApp({
      ...testControllerOptions,
      allowedToolDirectories: [],
      allowedToolDirectoriesSource: "default",
      databasePath: fixture.databasePath,
      sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
    });
    const detailResponse = await restartedRuntime.app.request(`http://127.0.0.1:42831/api/sessions/${session.id}`, {
      headers: authorizedRequestHeaders
    });
    const reopenedResponse = await restartedRuntime.app.request(
      `http://127.0.0.1:42831/api/sessions/${session.id}/workspace/open`,
      {
        method: "POST",
        headers: authorizedRequestHeaders
      }
    );

    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json() as { workspacePath: string }).workspacePath, firstWorkspacePath);
    assert.equal(reopenedResponse.status, 200);
    assert.equal((await reopenedResponse.json() as { workspacePath: string }).workspacePath, firstWorkspacePath);
    assert.equal(existsSync(join(firstWorkspacePath, "before-restart.txt")), true);
  } finally {
    fixture.cleanup();
  }
});
