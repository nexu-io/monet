import assert from "node:assert/strict";
import test from "node:test";

import type { ChatStorage } from "../chat-storage";
import type { ConnectorExecuteToolInput, ConnectorProvider, ConnectorListToolsInput } from "../connectors/provider";
import { createLogger } from "../logger";
import { createConnectorToolSource } from "./connectors";

test("connector tool source resolves connected curated tools for active monet install id", async () => {
  const listToolInputs: ConnectorListToolsInput[] = [];
  const provider: ConnectorProvider = {
    async listConnectors() {
      return [];
    },
    async getConnectionStatus() {
      return {
        connectorId: "github",
        state: "connected",
        connected: true,
        account: { accountLabel: "octocat" }
      };
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
    name: "github_list_pull_requests",
    description: "List pull requests for a selected repository.",
    requiresConfirmation: true,
    connector: {
      connectorId: "github",
      connectorName: "GitHub",
      accountLabel: "octocat",
      toolName: "List pull requests",
      providerToolId: "GITHUB_LIST_PULL_REQUESTS",
      approvalPolicy: {
        sideEffect: "read",
        approval: "first_use"
      }
    }
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

test("connector tool source prefixes provider tool names with normalized connector ids", async () => {
  const provider = createProviderWithTools([
    {
      connectorId: "github",
      providerToolId: "GITHUB_SEARCH_REPOSITORIES",
      name: "GITHUB_SEARCH_REPOSITORIES"
    },
    {
      connectorId: "notion",
      providerToolId: "NOTION_SEARCH_NOTION_PAGE",
      name: "NOTION_SEARCH_NOTION_PAGE"
    },
    {
      connectorId: "google_drive",
      providerToolId: "GOOGLEDRIVE_FIND_FILE",
      name: "GOOGLEDRIVE_FIND_FILE"
    }
  ]);
  const source = createConnectorToolSource({ provider });

  const tools = await source.resolveTools(createToolSourceContext());

  assert.deepEqual(
    tools.map((tool) => tool.metadata.name),
    ["github_search_repositories", "notion_search_notion_page", "google_drive_find_file"]
  );
});

test("connector tool source fails closed when prefixed connector names collide", async () => {
  const provider = createProviderWithTools([
    {
      connectorId: "github",
      providerToolId: "GITHUB_SEARCH_REPOSITORIES",
      name: "GITHUB_SEARCH_REPOSITORIES"
    },
    {
      connectorId: "github",
      providerToolId: "CUSTOM_ACTION",
      name: "search_repositories"
    }
  ]);
  const source = createConnectorToolSource({ provider });

  await assert.rejects(
    async () => source.resolveTools(createToolSourceContext()),
    /Connector tool name collision after prefixing: github_search_repositories/
  );
});

test("connector tool execution dispatches prefixed tools through the provider", async () => {
  const executeToolInputs: ConnectorExecuteToolInput[] = [];
  const provider: ConnectorProvider = {
    async listConnectors() {
      return [];
    },
    async getConnectionStatus() {
      return {
        connectorId: "github",
        state: "connected",
        connected: true,
        account: { accountLabel: "monet-bot" }
      };
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
    async listTools() {
      return [
        {
          connectorId: "github",
          providerToolId: "GITHUB_GET_REPOSITORY",
          name: "GITHUB_GET_REPOSITORY",
          displayName: "Get repository",
          description: "Get repository details.",
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
            approval: "never"
          }
        }
      ];
    },
    async executeTool(input) {
      executeToolInputs.push(input);
      return {
        output: { fullName: "monet/connectors" },
        providerExecutionId: "provider-exec-1"
      };
    }
  };
  const source = createConnectorToolSource({ provider });
  const abortController = new AbortController();
  const tools = await source.resolveTools(createToolSourceContext());

  assert.equal(tools[0]?.metadata.name, "github_get_repository");

  const output = await tools[0]?.execute(
    { owner: "monet", repo: "connectors" },
    {
      toolCallId: "tool-call-1",
      messages: [],
      abortSignal: abortController.signal,
      persistedToolCallId: "tool-call-1"
    }
  );

  assert.deepEqual(output, { fullName: "monet/connectors" });
  assert.equal(executeToolInputs.length, 1);
  assert.deepEqual(executeToolInputs[0], {
    userId: "monet-install-id",
    toolId: "GITHUB_GET_REPOSITORY",
    args: { owner: "monet", repo: "connectors" },
    abortSignal: abortController.signal
  });
});

function createProviderWithTools(
  tools: ReadonlyArray<{ connectorId: "github" | "notion" | "google_drive"; providerToolId: string; name: string }>
): ConnectorProvider {
  return {
    async listConnectors() {
      return [];
    },
    async getConnectionStatus(input) {
      return {
        connectorId: input.connectorId,
        state: "connected",
        connected: true,
        account: { accountLabel: `${input.connectorId}-account` }
      };
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
    async listTools() {
      return tools.map((tool) => ({
        connectorId: tool.connectorId,
        providerToolId: tool.providerToolId,
        name: tool.name,
        displayName: tool.name,
        description: `${tool.name} description`,
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        policy: {
          sideEffect: "read",
          approval: "never"
        }
      }));
    },
    executeTool() {
      throw new Error("not used");
    }
  };
}

function createToolSourceContext() {
  return {
    runId: "run_test",
    chatStorage: {
      getMonetInstallId() {
        return "monet-install-id";
      }
    } as ChatStorage,
    logger: createLogger("test")
  };
}
