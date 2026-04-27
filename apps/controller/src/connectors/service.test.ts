import assert from "node:assert/strict";
import test from "node:test";

import { createConnectorProviderError } from "./errors";
import { createConnectorService, normalizeConnectionState, normalizeProviderStatus } from "./service";
import type { ConnectorProvider, ConnectorCreateConnectionInput } from "./provider";

test("connector service starts OAuth with cryptographically random single-use state", async () => {
  const states: string[] = [];

  const provider: ConnectorProvider = {
    async listConnectors() {
      return [];
    },
    getConnectionStatus() {
      throw new Error("not used in start connection state test");
    },
    async connect(input: ConnectorCreateConnectionInput) {
      states.push(input.state);
      return {
        connectorId: input.connectorId,
        kind: "pending",
        expiresAt: "2026-04-27T10:05:00.000Z"
      };
    },
    completeConnection() {
      throw new Error("not used in start connection state test");
    },
    disconnect() {
      throw new Error("not used in start connection state test");
    },
    listTools() {
      throw new Error("not used in start connection state test");
    },
    executeTool() {
      throw new Error("not used in start connection state test");
    }
  };

  const service = createConnectorService({ provider });

  await service.startConnection({ userId: "monet-install-id", connectorId: "github" });
  await service.startConnection({ userId: "monet-install-id", connectorId: "github" });

  assert.equal(states.length, 2);
  assert.notEqual(states[0], states[1]);
  assert.match(states[0] ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(states[1] ?? "", /^[A-Za-z0-9_-]{43}$/);
});

test("connector service normalizes provider connection states for catalog status", () => {
  assert.equal(normalizeConnectionState("connected", false), "connected");
  assert.equal(normalizeConnectionState("not_connected", false), "not_connected");
  assert.equal(normalizeConnectionState("disconnected", false), "not_connected");
  assert.equal(normalizeConnectionState("expired", false), "expired");
  assert.equal(normalizeConnectionState("not_connected", false, "connection_expired"), "expired");
  assert.equal(normalizeConnectionState("unavailable", false), "unavailable");

  assert.deepEqual(
    normalizeProviderStatus({
      connectorId: "github",
      state: "connected",
      connected: true,
      account: {
        accountLabel: "octocat",
        providerConnectionId: "conn_123"
      }
    }),
    {
      status: "connected",
      connected: true,
      connectedAccountLabel: "octocat",
      account: {
        accountLabel: "octocat",
        providerConnectionId: "conn_123"
      }
    }
  );
});

test("connector service maps provider status errors to safe service statuses", async () => {
  const service = createConnectorService({
    provider: {
      async listConnectors() {
        return [];
      },
      async getConnectionStatus() {
        throw createConnectorProviderError("connection_missing", { message: "missing" });
      },
      connect() {
        throw new Error("not used");
      },
      completeConnection() {
        throw new Error("not used");
      },
      disconnect() {
        throw new Error("not used");
      },
      listTools() {
        throw new Error("not used");
      },
      executeTool() {
        throw new Error("not used");
      }
    }
  });

  assert.deepEqual(await service.getConnection({ userId: "monet-install-id", connectorId: "github" }), {
    status: "not_connected",
    connected: false,
    lastErrorCode: "connection_missing",
    lastErrorMessage: "missing"
  });
});
