import assert from "node:assert/strict";
import test from "node:test";

import { createConnectorService } from "./service";
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
