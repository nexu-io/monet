import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createChatStorage } from "../chat-storage";
import { createConnectorProviderError } from "../connectors/errors";
import { hashConnectorOAuthState } from "../connectors/oauth-state";
import type { ConnectorCatalogCard, ConnectorDetail, ConnectorService } from "../connectors/service";
import { registerConnectorRoutes } from "./connectors";

function createRouteStorage(databasePath: string) {
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

test("connectors endpoint returns connector catalog with status", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const catalogCard: ConnectorCatalogCard = {
    id: "github",
    displayName: "GitHub",
    description: "Access repositories and pull requests.",
    category: "developer",
    icon: "github",
    featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"],
    enabledByDefault: true,
    minimumApprovalPolicy: {
      sideEffect: "read",
      approval: "first_use"
    },
    capabilitySummaries: ["Read repository data."],
    status: "connected",
    connectedAccountLabel: "octocat"
  };

  let userIdRequested: string | null = null;

  const connectorService: ConnectorService = {
    async listConnectors(input) {
      userIdRequested = input.userId;
      return [catalogCard];
    },
    getConnector() {
      throw new Error("not used in connectors route test");
    },
    getConnection() {
      throw new Error("not used in connectors route test");
    },
    startConnection() {
      throw new Error("not used in connectors route test");
    },
    completeConnection() {
      throw new Error("not used in connectors route test");
    },
    disconnect() {
      throw new Error("not used in connectors route test");
    }
  };

  const monetInstallId = "monet-install-id-123";

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors", {
    method: "GET"
  });

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(payload, {
    connectors: [
      {
        id: "github",
        displayName: "GitHub",
        description: "Access repositories and pull requests.",
        category: "developer",
        icon: "github",
        featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"],
        enabledByDefault: true,
        minimumApprovalPolicy: {
          sideEffect: "read",
          approval: "first_use"
        },
        capabilitySummaries: ["Read repository data."],
        status: "connected",
        connectedAccountLabel: "octocat"
      }
    ]
  });

  assert.equal(userIdRequested, monetInstallId);
});

test("connector detail endpoint returns connector status, tools, and approval policies", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const connectorDetail: ConnectorDetail = {
    id: "github",
    providerConnectorId: "GITHUB",
    displayName: "GitHub",
    description: "Access repositories and pull requests.",
    category: "developer",
    icon: "github",
    featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"],
    enabledByDefault: true,
    minimumApprovalPolicy: {
      sideEffect: "read",
      approval: "first_use"
    },
    capabilitySummaries: ["Read repository data."],
    status: "connected",
    connectedAccountLabel: "octocat",
    connection: {
      status: "connected",
      connected: true,
      connectedAccountLabel: "octocat",
      account: {
        accountLabel: "octocat",
        providerConnectionId: "conn_123",
        providerConnectorId: "GITHUB"
      }
    },
    allowedTools: [
      {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        displayName: "Search issues and pull requests",
        summary: "Search issues and pull requests across accessible repositories.",
        policy: {
          sideEffect: "read",
          approval: "first_use"
        }
      }
    ]
  };

  let requested: { userId: string; connectorId: string } | null = null;

  const connectorService: ConnectorService = {
    listConnectors() {
      throw new Error("not used in connector detail route test");
    },
    async getConnector(input) {
      requested = { userId: input.userId, connectorId: input.connectorId };
      return connectorDetail;
    },
    getConnection() {
      throw new Error("not used in connector detail route test");
    },
    startConnection() {
      throw new Error("not used in connector detail route test");
    },
    completeConnection() {
      throw new Error("not used in connector detail route test");
    },
    disconnect() {
      throw new Error("not used in connector detail route test");
    }
  };

  const monetInstallId = "monet-install-id-456";

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/github", {
    method: "GET"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connector: connectorDetail });
  assert.deepEqual(requested, { userId: monetInstallId, connectorId: "github" });
});

test("connector detail endpoint returns normalized connector errors", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const connectorService: ConnectorService = {
    listConnectors() {
      throw new Error("not used in connector detail error route test");
    },
    getConnector() {
      throw createConnectorProviderError("tool_not_found", { message: "Unknown connector: missing" });
    },
    getConnection() {
      throw new Error("not used in connector detail error route test");
    },
    startConnection() {
      throw new Error("not used in connector detail error route test");
    },
    completeConnection() {
      throw new Error("not used in connector detail error route test");
    },
    disconnect() {
      throw new Error("not used in connector detail error route test");
    }
  };

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return "monet-install-id-789";
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/missing", {
    method: "GET"
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "tool_not_found",
    message: "Unknown connector: missing"
  });
});

test("connector connect endpoint starts connection flow for Monet install", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  const monetInstallId = "monet-install-id-connect";
  let requested: { userId: string; connectorId: string; redirectUrl?: string } | null = null;

  const connectorService: ConnectorService = {
    listConnectors() {
      throw new Error("not used in connector connect route test");
    },
    getConnector() {
      throw new Error("not used in connector connect route test");
    },
    getConnection() {
      throw new Error("not used in connector connect route test");
    },
    async startConnection(input) {
      requested = {
        userId: input.userId,
        connectorId: input.connectorId,
        ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {})
      };

      return {
        connectorId: "github",
        kind: "redirect_required",
        providerConnectionId: "conn_123",
        redirectUrl: "https://provider.example/oauth/start",
        expiresAt: "2026-04-27T10:05:00.000Z"
      };
    },
    completeConnection() {
      throw new Error("not used in connector connect route test");
    },
    disconnect() {
      throw new Error("not used in connector connect route test");
    }
  };

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/github/connect", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ redirectUrl: "monet://connectors/callback" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connectorId: "github",
    status: "redirect_required",
    providerConnectionId: "conn_123",
    redirectUrl: "https://provider.example/oauth/start",
    expiresAt: "2026-04-27T10:05:00.000Z"
  });
  assert.deepEqual(requested, {
    userId: monetInstallId,
    connectorId: "github",
    redirectUrl: "monet://connectors/callback"
  });
});

test("connector OAuth callback validates state before redirecting back to connectors", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  const monetInstallId = "monet-install-id-callback";
  const state = "oauth-state-secret";
  const persistedConnections: unknown[] = [];

  registerConnectorRoutes(app, {
    connectorService: {
      ...createUnusedConnectorService(),
      async completeConnection(input) {
        assert.equal(input.userId, monetInstallId);
        assert.equal(input.connectorId, "github");
        assert.equal(input.providerConnectionId, "conn_123");

        return {
          connectorId: "github",
          state: "connected",
          connected: true,
          providerConnectionId: "conn_123",
          account: {
            accountLabel: "Octocat",
            providerConnectionId: "conn_123"
          },
          persistence: {
            status: "connected",
            providerConnectionId: "conn_123",
            providerMetadataJson: JSON.stringify({ providerStatus: "ACTIVE", accountId: "acct_123" }),
            accountLabel: "Octocat",
            lastConnectedAt: "2026-04-27T10:00:00.000Z",
            lastError: null
          }
        };
      }
    },
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        },
        getConnectorOAuthStateByHash(stateHash: string) {
          if (stateHash !== hashConnectorOAuthState(state)) {
            return null;
          }

          return {
            id: "cos_123",
            stateHash,
            userId: monetInstallId,
            connectorId: "github",
            provider: "composio",
            redirectUrl: null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            consumedAt: null,
            createdAt: new Date().toISOString()
          };
        },
        completeConnectorOAuthConnection(input: unknown) {
          persistedConnections.push(input);
        }
      }) as never
  });

  const response = await app.request(`http://127.0.0.1:42831/connectors/oauth/callback/github?state=${state}&connected_account_id=conn_123`, {
    method: "GET",
    redirect: "manual"
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/connectors?connector_oauth=connected&connector_id=github");
  assert.deepEqual(persistedConnections, [
    {
      oauthStateId: "cos_123",
      userId: monetInstallId,
      connectorId: "github",
      provider: "composio",
      providerConnectionId: "conn_123",
      providerMetadataJson: JSON.stringify({ providerStatus: "ACTIVE", accountId: "acct_123" }),
      accountLabel: "Octocat",
      status: "connected",
      lastConnectedAt: "2026-04-27T10:00:00.000Z",
      lastError: null
    }
  ]);

  const replayResponse = await app.request("http://127.0.0.1:42831/connectors/oauth/callback/github?state=wrong-state", {
    method: "GET",
    redirect: "manual"
  });

  assert.equal(replayResponse.status, 302);
  assert.equal(replayResponse.headers.get("location"), "/connectors?connector_oauth=error");
});

test("connector OAuth return route renders browser handoff page", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  registerConnectorRoutes(app, {
    connectorService: {
      listConnectors() {
        throw new Error("not used in OAuth return route test");
      },
      getConnector() {
        throw new Error("not used in OAuth return route test");
      },
      getConnection() {
        throw new Error("not used in OAuth return route test");
      },
      startConnection() {
        throw new Error("not used in OAuth return route test");
      },
      completeConnection() {
        throw new Error("not used in OAuth return route test");
      },
      disconnect() {
        throw new Error("not used in OAuth return route test");
      }
    } as never,
    getChatStorage: () => ({}) as never
  });

  const response = await app.request("http://127.0.0.1:42831/connectors?connector_oauth=connected&connector_id=github");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const body = await response.text();
  assert.match(body, /Return to Monet to continue/);
  assert.match(body, /window\.close\(\)/);
});

test("connector OAuth callback persists metadata, consumes state, rejects replay, and returns safely", async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-connector-callback-tests-"));

  try {
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    const storage = createRouteStorage(join(fixtureDir, "controller.sqlite"));
    const monetInstallId = storage.getMonetInstallId();
    const state = "oauth-state-secret-real-storage";
    const stateHash = hashConnectorOAuthState(state);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    let completionCount = 0;

    const oauthState = storage.createConnectorOAuthState({
      stateHash,
      userId: monetInstallId,
      connectorId: "github",
      provider: "composio",
      redirectUrl: "https://attacker.example/unsafe-return",
      expiresAt
    });

    registerConnectorRoutes(app, {
      connectorService: {
        ...createUnusedConnectorService(),
        async completeConnection(input) {
          completionCount += 1;
          assert.equal(input.userId, monetInstallId);
          assert.equal(input.connectorId, "github");
          assert.equal(input.providerConnectionId, "conn_callback_123");

          return {
            connectorId: "github",
            state: "connected",
            connected: true,
            providerConnectionId: "conn_callback_123",
            account: {
              accountLabel: "Octocat Callback",
              providerConnectionId: "conn_callback_123"
            },
            persistence: {
              status: "connected",
              providerConnectionId: "conn_callback_123",
              providerMetadataJson: JSON.stringify({ providerStatus: "ACTIVE", accountId: "acct_callback_123" }),
              accountLabel: "Octocat Callback",
              lastConnectedAt: "2026-04-27T11:00:00.000Z",
              lastError: null
            }
          };
        }
      },
      getChatStorage: () => storage
    });

    const callbackUrl = `http://127.0.0.1:42831/connectors/oauth/callback/github?state=${state}&connected_account_id=conn_callback_123`;
    const response = await app.request(callbackUrl, { method: "GET", redirect: "manual" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/connectors?connector_oauth=connected&connector_id=github");
    assert.equal(response.headers.get("location")?.includes("attacker.example"), false);
    assert.equal(completionCount, 1);

    const persistedConnection = storage.getConnectorConnection({
      userId: monetInstallId,
      connectorId: "github",
      provider: "composio"
    });

    assert.ok(persistedConnection);
    assert.equal(persistedConnection.userId, monetInstallId);
    assert.equal(persistedConnection.connectorId, "github");
    assert.equal(persistedConnection.provider, "composio");
    assert.equal(persistedConnection.providerConnectionId, "conn_callback_123");
    assert.equal(persistedConnection.providerMetadataJson, JSON.stringify({ providerStatus: "ACTIVE", accountId: "acct_callback_123" }));
    assert.equal(persistedConnection.accountLabel, "Octocat Callback");
    assert.equal(persistedConnection.status, "connected");
    assert.equal(persistedConnection.lastConnectedAt, "2026-04-27T11:00:00.000Z");
    assert.equal(persistedConnection.lastError, null);

    const consumedState = storage.getConnectorOAuthStateByHash(stateHash);
    assert.ok(consumedState);
    assert.equal(consumedState.id, oauthState.id);
    assert.equal(consumedState.consumedAt !== null, true);

    const replayResponse = await app.request(callbackUrl, { method: "GET", redirect: "manual" });

    assert.equal(replayResponse.status, 302);
    assert.equal(replayResponse.headers.get("location"), "/connectors?connector_oauth=error");
    assert.equal(completionCount, 1);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("connector persistence rejects OAuth tokens, provider API keys, and raw authorization headers", async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-connector-persistence-safety-tests-"));

  try {
    const storage = createRouteStorage(join(fixtureDir, "controller.sqlite"));
    const monetInstallId = storage.getMonetInstallId();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    assert.throws(
      () =>
        storage.createConnectorOAuthState({
          stateHash: hashConnectorOAuthState("unsafe-redirect-state"),
          userId: monetInstallId,
          connectorId: "github",
          provider: "composio",
          redirectUrl:
            "https://provider.example/callback?access_token=oauth-access-token-secret&api_key=provider-api-key-secret&authorization=Bearer%20raw-auth-secret",
          expiresAt
        }),
      /CHECK constraint failed: connector_oauth_states_no_redirect_url_secrets/
    );

    const oauthState = storage.createConnectorOAuthState({
      stateHash: hashConnectorOAuthState("unsafe-connection-state"),
      userId: monetInstallId,
      connectorId: "github",
      provider: "composio",
      redirectUrl: "/connectors",
      expiresAt
    });

    assert.throws(
      () =>
        storage.completeConnectorOAuthConnection({
          oauthStateId: oauthState.id,
          userId: monetInstallId,
          connectorId: "github",
          provider: "composio",
          providerConnectionId: "conn_unsafe_123",
          providerMetadataJson: JSON.stringify({
            accessToken: "connection-access-token-secret",
            refresh_token: "connection-refresh-token-secret",
            providerApiKey: "connection-provider-api-key-secret",
            authorization: "Bearer connection-authorization-header-secret"
          }),
          accountLabel: "Octocat",
          status: "connected",
          lastConnectedAt: "2026-04-27T12:00:00.000Z",
          lastError: "upstream returned Authorization: Bearer connection-last-error-auth-secret"
        }),
      /CHECK constraint failed: connector_connections_no_provider_metadata_secrets|CHECK constraint failed: connector_connections_no_last_error_secrets/
    );

    assert.equal(
      storage.getConnectorConnection({
        userId: monetInstallId,
        connectorId: "github",
        provider: "composio"
      }),
      null
    );

    const unconsumedState = storage.getConnectorOAuthStateByHash(hashConnectorOAuthState("unsafe-connection-state"));

    assert.ok(unconsumedState);
    assert.equal(unconsumedState.consumedAt, null);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("connector OAuth callback rejects consumed, expired, mismatched, and oversized state", async () => {
  const cases = [
    {
      name: "consumed",
      state: "consumed-state",
      oauthState: { consumedAt: "2026-04-27T10:00:00.000Z", expiresAt: new Date(Date.now() + 60_000).toISOString(), userId: "monet-install-id" }
    },
    {
      name: "expired",
      state: "expired-state",
      oauthState: { consumedAt: null, expiresAt: new Date(Date.now() - 60_000).toISOString(), userId: "monet-install-id" }
    },
    {
      name: "wrong-user",
      state: "wrong-user-state",
      oauthState: { consumedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString(), userId: "other-install-id" }
    }
  ] as const;

  for (const scenario of cases) {
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    let completed = false;

    registerConnectorRoutes(app, {
      connectorService: {
        ...createUnusedConnectorService(),
        async completeConnection() {
          completed = true;
          throw new Error("OAuth callback should reject invalid state before provider completion");
        }
      },
      getChatStorage: () =>
        ({
          getMonetInstallId() {
            return "monet-install-id";
          },
          getConnectorOAuthStateByHash(stateHash: string) {
            if (stateHash !== hashConnectorOAuthState(scenario.state)) {
              return null;
            }

            return {
              id: `cos_${scenario.name}`,
              stateHash,
              userId: scenario.oauthState.userId,
              connectorId: "github",
              provider: "composio",
              redirectUrl: null,
              expiresAt: scenario.oauthState.expiresAt,
              consumedAt: scenario.oauthState.consumedAt,
              createdAt: new Date().toISOString()
            };
          },
          completeConnectorOAuthConnection() {
            throw new Error("OAuth callback should not persist invalid state");
          }
        }) as never
    });

    const response = await app.request(
      `http://127.0.0.1:42831/connectors/oauth/callback/github?state=${scenario.state}&connected_account_id=conn_123`,
      { method: "GET", redirect: "manual" }
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/connectors?connector_oauth=error");
    assert.equal(completed, false);
  }

  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  registerConnectorRoutes(app, {
    connectorService: createUnusedConnectorService(),
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return "monet-install-id";
        },
        getConnectorOAuthStateByHash() {
          throw new Error("Oversized states must be rejected before hashing lookup");
        }
      }) as never
  });

  const oversizedResponse = await app.request(
    `http://127.0.0.1:42831/connectors/oauth/callback/github?state=${"a".repeat(513)}&connected_account_id=conn_123`,
    { method: "GET", redirect: "manual" }
  );

  assert.equal(oversizedResponse.status, 302);
  assert.equal(oversizedResponse.headers.get("location"), "/connectors?connector_oauth=error");
});

test("connector disconnect endpoint revokes provider access and marks local connection disconnected", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  const monetInstallId = "monet-install-id-disconnect";
  let requested: { userId: string; connectorId: string } | null = null;
  let canceledConnectorId: string | null = null;
  let disconnected: { userId: string; connectorId: string; provider: string } | null = null;

  registerConnectorRoutes(app, {
    connectorService: {
      ...createUnusedConnectorService(),
      async disconnect(input) {
        requested = { userId: input.userId, connectorId: input.connectorId };
      }
    },
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        },
        cancelPendingConnectorApprovals(input: { connectorId: string }) {
          canceledConnectorId = input.connectorId;
          return 0;
        },
        markConnectorConnectionDisconnected(input: { userId: string; connectorId: string; provider: string }) {
          disconnected = input;
          return null;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/github/connection", {
    method: "DELETE"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connectorId: "github",
    status: "not_connected"
  });
  assert.equal(canceledConnectorId, "github");
  assert.deepEqual(requested, { userId: monetInstallId, connectorId: "github" });
  assert.deepEqual(disconnected, { userId: monetInstallId, connectorId: "github", provider: "composio" });
});

function createUnusedConnectorService(): ConnectorService {
  return {
    listConnectors() {
      throw new Error("not used in connector OAuth callback route test");
    },
    getConnector() {
      throw new Error("not used in connector OAuth callback route test");
    },
    getConnection() {
      throw new Error("not used in connector OAuth callback route test");
    },
    startConnection() {
      throw new Error("not used in connector OAuth callback route test");
    },
    completeConnection() {
      throw new Error("not used in connector OAuth callback route test");
    },
    disconnect() {
      throw new Error("not used in connector OAuth callback route test");
    }
  };
}
