import assert from "node:assert/strict";
import test from "node:test";

import type { ChatStorage } from "../chat-storage";
import type { ConnectorExecuteToolInput, ConnectorProvider, ConnectorListToolsInput } from "../connectors/provider";
import { createLogger } from "../logger";
import { createConnectorToolSource } from "./connectors";

test("connector tool source resolves connected curated tools for active monet install id", async () => {
  const listToolInputs: ConnectorListToolsInput[] = [];
  const getConnectionStatusInputs: unknown[] = [];
  const provider: ConnectorProvider = {
    async listConnectors() {
      return [];
    },
    async getConnectionStatus(input) {
      getConnectionStatusInputs.push(input);
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
  const abortController = new AbortController();
  const tools = await source.resolveTools({
    runId: "run_test",
    sessionId: "session_test",
    sessionWorkspacePath: "/tmp/monet-sessions/session_test/workspace",
    chatStorage: {
      getMonetInstallId() {
        return "monet-install-id";
      }
    } as ChatStorage,
    logger: createLogger("test"),
    abortSignal: abortController.signal
  });

  assert.deepEqual(listToolInputs, [{ userId: "monet-install-id", abortSignal: abortController.signal }]);
  assert.deepEqual(getConnectionStatusInputs, [
    { userId: "monet-install-id", connectorId: "github", abortSignal: abortController.signal }
  ]);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0]?.metadata, {
    name: "github_list_pull_requests",
    description: "List pull requests for a selected repository.",
    requiresConfirmation: false,
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
  let connectorExecutionMetadata: unknown;

  assert.equal(tools[0]?.metadata.name, "github_get_repository");

  const output = await tools[0]?.execute(
    { owner: "monet", repo: "connectors" },
    {
      toolCallId: "tool-call-1",
      messages: [],
      abortSignal: abortController.signal,
      persistedToolCallId: "tool-call-1",
      sessionId: "session_test",
      sessionWorkspacePath: "/tmp/monet-sessions/session_test/workspace",
      setConnectorExecutionMetadata(metadata) {
        connectorExecutionMetadata = metadata;
      }
    }
  );

  assert.deepEqual(output, { fullName: "monet/connectors" });
  assert.deepEqual(connectorExecutionMetadata, {
    providerExecutionId: "provider-exec-1",
    providerExecutionMetadata: null
  });
  assert.equal(executeToolInputs.length, 1);
  assert.deepEqual(executeToolInputs[0], {
    userId: "monet-install-id",
    toolId: "GITHUB_GET_REPOSITORY",
    args: { owner: "monet", repo: "connectors" },
    abortSignal: abortController.signal
  });
});

test("connector tool source enforces approval policy metadata for runtime tools", async () => {
  const provider = createProviderWithTools([
    {
      connectorId: "github",
      providerToolId: "GITHUB_GET_A_REPOSITORY",
      name: "GITHUB_GET_A_REPOSITORY",
      policy: { sideEffect: "read", approval: "never" }
    },
    {
      connectorId: "github",
      providerToolId: "GITHUB_CREATE_ISSUE",
      name: "GITHUB_CREATE_ISSUE",
      policy: { sideEffect: "write", approval: "always" }
    },
    {
      connectorId: "google_drive",
      providerToolId: "GOOGLEDRIVE_DELETE_FILE",
      name: "GOOGLEDRIVE_DELETE_FILE",
      policy: { sideEffect: "destructive", approval: "always" }
    }
  ]);
  const source = createConnectorToolSource({ provider });

  const tools = await source.resolveTools(createToolSourceContext());

  assert.deepEqual(
    tools.map((tool) => ({
      name: tool.metadata.name,
      requiresConfirmation: tool.metadata.requiresConfirmation,
      policy: tool.metadata.connector?.approvalPolicy
    })),
    [
      {
        name: "github_get_a_repository",
        requiresConfirmation: false,
        policy: { sideEffect: "read", approval: "never" }
      },
      {
        name: "github_create_issue",
        requiresConfirmation: true,
        policy: { sideEffect: "write", approval: "always" }
      },
      {
        name: "google_drive_delete_file",
        requiresConfirmation: true,
        policy: { sideEffect: "destructive", approval: "always" }
      }
    ]
  );
});

function createProviderWithTools(
  tools: ReadonlyArray<{
    connectorId: "github" | "notion" | "google_drive";
    providerToolId: string;
    name: string;
    policy?: { sideEffect: "read" | "write" | "destructive" | "external_send"; approval: "never" | "first_use" | "always" };
  }>
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
        policy: tool.policy ?? {
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
    sessionId: "session_test",
    sessionWorkspacePath: "/tmp/monet-sessions/session_test/workspace",
    chatStorage: {
      getMonetInstallId() {
        return "monet-install-id";
      }
    } as ChatStorage,
    logger: createLogger("test")
  };
}
