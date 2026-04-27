import assert from "node:assert/strict";
import test from "node:test";

import type { StoredConnectorConnection } from "../chat-storage";
import { ComposioConnectorProvider } from "./composio-provider";
import { ConnectorProviderError } from "./errors";

test("Composio connector provider returns only connected allowlisted tools for a connector", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    return jsonResponse({
      items: [
        {
          slug: "GITHUB_SEARCH_REPOSITORIES",
          name: "Provider search repositories",
          description: "Provider repository search description.",
          toolkit: { slug: "GITHUB" },
          input_parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        },
        {
          slug: "GITHUB_CREATE_AN_ISSUE",
          name: "Create issue",
          description: "This write-capable tool is not in the curated v1 allowlist.",
          toolkit: { slug: "GITHUB" },
          input_parameters: { type: "object" }
        },
        {
          slug: "GITHUB_LIST_PULL_REQUESTS",
          name: "List pull requests",
          description: "Wrong toolkit should be ignored.",
          toolkit: { slug: "NOTION" },
          input_parameters: { type: "object" }
        }
      ]
    });
  });

  const provider = new ComposioConnectorProvider({
    config: {
      apiKey: "composio-api-key",
      baseUrl: "https://composio.test/",
      timeoutMs: null,
      authConfigIds: { github: "github-auth-config" }
    },
    storage: createStorage({
      github: createStoredConnection({ connectorId: "github", providerConnectionId: "conn_github", status: "connected" })
    })
  });

  const tools = await provider.listTools({ userId: "monet-install-id", connectorId: "github" });

  assert.equal(requests.length, 1);
  assert.equal(requests[0], "https://composio.test/api/v3.1/tools?toolkit_slug=GITHUB&limit=1000");
  assert.deepEqual(
    tools.map((tool) => ({
      connectorId: tool.connectorId,
      providerToolId: tool.providerToolId,
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      policy: tool.policy
    })),
    [
      {
        connectorId: "github",
        providerToolId: "GITHUB_SEARCH_REPOSITORIES",
        name: "GITHUB_SEARCH_REPOSITORIES",
        displayName: "Provider search repositories",
        description: "Provider repository search description.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        policy: { sideEffect: "read", approval: "first_use" }
      }
    ]
  );
});

test("Composio connector provider skips disconnected connectors when listing all tools", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => jsonResponse({ items: [] }));
  const provider = new ComposioConnectorProvider({
    config: {
      apiKey: "composio-api-key",
      baseUrl: "https://composio.test",
      timeoutMs: null,
      authConfigIds: { github: "github-auth-config", notion: "notion-auth-config", google_drive: "drive-auth-config" }
    },
    storage: createStorage({
      github: createStoredConnection({ connectorId: "github", providerConnectionId: "conn_github", status: "connected" }),
      notion: createStoredConnection({ connectorId: "notion", providerConnectionId: null, status: "disconnected" }),
      google_drive: createStoredConnection({ connectorId: "google_drive", providerConnectionId: "conn_drive", status: "expired" })
    })
  });

  await provider.listTools({ userId: "monet-install-id" });

  assert.equal(fetchMock.mock.callCount(), 1);
});

test("Composio connector provider normalizes HTTP and execution errors", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/api/v3.1/tools/execute/")) {
      return jsonResponse({ successful: false, error: { code: "validation_failed", status: 422 } });
    }

    return jsonResponse({}, 429);
  });

  const provider = new ComposioConnectorProvider({
    config: {
      apiKey: "composio-api-key",
      baseUrl: "https://composio.test",
      timeoutMs: null,
      authConfigIds: { github: "github-auth-config" }
    },
    storage: createStorage({
      github: createStoredConnection({ connectorId: "github", providerConnectionId: "conn_github", status: "connected" })
    })
  });

  assert.deepEqual(await provider.getConnectionStatus({ userId: "monet-install-id", connectorId: "github" }), {
    connectorId: "github",
    state: "connected",
    connected: true,
    account: {
      accountLabel: "github-account",
      providerConnectionId: "conn_github",
      providerConnectorId: "GITHUB",
      connectedAt: "2026-04-27T10:00:00.000Z",
      updatedAt: "2026-04-27T10:00:00.000Z"
    },
    lastErrorCode: "rate_limited",
    lastErrorMessage: "Connector provider rate limit exceeded. Try again later."
  });

  await assert.rejects(
    async () =>
      provider.executeTool({
        userId: "monet-install-id",
        toolId: "GITHUB_SEARCH_REPOSITORIES",
        args: { query: "monet" },
        abortSignal: new AbortController().signal
      }),
    (error) => error instanceof ConnectorProviderError && error.code === "invalid_arguments" && error.statusCode === 422
  );
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createStorage(connections: Partial<Record<"github" | "notion" | "google_drive", StoredConnectorConnection>>) {
  return {
    createConnectorOAuthState() {
      throw new Error("not used");
    },
    getConnectorConnection(input: { connectorId: "github" | "notion" | "google_drive" }) {
      return connections[input.connectorId] ?? null;
    }
  } as never;
}

function createStoredConnection(input: {
  connectorId: "github" | "notion" | "google_drive";
  providerConnectionId: string | null;
  status: "connected" | "expired" | "disconnected";
}): StoredConnectorConnection {
  return {
    id: `connection-${input.connectorId}`,
    userId: "monet-install-id",
    connectorId: input.connectorId,
    provider: "composio",
    providerConnectionId: input.providerConnectionId,
    providerMetadataJson: JSON.stringify({ providerConnectorId: input.connectorId === "google_drive" ? "GOOGLEDRIVE" : input.connectorId.toUpperCase() }),
    accountLabel: `${input.connectorId}-account`,
    status: input.status,
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    lastConnectedAt: input.status === "connected" ? "2026-04-27T10:00:00.000Z" : null,
    lastError: input.status === "expired" ? JSON.stringify({ code: "connection_expired", message: "expired" }) : null
  };
}
