import assert from "node:assert/strict";
import test from "node:test";

import type { ChatStorage } from "../chat-storage";
import type { ConnectorProvider, ConnectorListToolsInput } from "../connectors/provider";
import { createLogger } from "../logger";
import { createConnectorToolSource } from "./connectors";

test("connector tool source resolves connected curated tools for active monet install id", async () => {
  const listToolInputs: ConnectorListToolsInput[] = [];
  const provider: ConnectorProvider = {
    async listConnectors() {
      return [];
    },
    getConnectionStatus() {
      throw new Error("not used");
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
    async listTools(input) {
      listToolInputs.push(input);
      return [
        {
          connectorId: "github",
          providerToolId: "GITHUB_LIST_PULL_REQUESTS",
          name: "GITHUB_LIST_PULL_REQUESTS",
          displayName: "List pull requests",
          description: "List pull requests for a selected repository.",
          inputSchema: {
            type: "object",
            properties: {
              owner: { type: "string" },
              repo: { type: "string" }
            },
            required: ["owner", "repo"],
            additionalProperties: false
          },
          policy: {
            sideEffect: "read",
            approval: "first_use"
          }
        }
      ];
    },
    executeTool() {
      throw new Error("not used");
    }
  };
  const source = createConnectorToolSource({ provider });
  const tools = await source.resolveTools({
    runId: "run_test",
    chatStorage: {
      getMonetInstallId() {
        return "monet-install-id";
      }
    } as ChatStorage,
    logger: createLogger("test")
  });

  assert.deepEqual(listToolInputs, [{ userId: "monet-install-id" }]);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0]?.metadata, {
    name: "GITHUB_LIST_PULL_REQUESTS",
    description: "List pull requests for a selected repository.",
    requiresConfirmation: true
  });
  const aiSdkInputSchema = tools[0]?.inputSchema as { jsonSchema?: unknown };

  assert.deepEqual(aiSdkInputSchema.jsonSchema, {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" }
    },
    required: ["owner", "repo"],
    additionalProperties: false
  });
});
