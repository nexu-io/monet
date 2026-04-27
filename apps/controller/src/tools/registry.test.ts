import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import type { ConnectorProvider } from "../connectors/provider";
import { createLogger } from "../logger";
import { createConnectorToolSource } from "./connectors";
import { createStaticToolSource, createToolRegistry } from "./registry";

interface ToolCallRow {
  readonly run_id: string;
  readonly tool_name: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly output_truncated: number;
  readonly output_size_bytes: number | null;
  readonly connector_id: string | null;
  readonly connector_name: string | null;
  readonly connector_account_label: string | null;
  readonly connector_tool_name: string | null;
  readonly connector_provider_tool_id: string | null;
  readonly connector_arguments_summary: string | null;
  readonly connector_approval_policy_json: string | null;
  readonly connector_provider_execution_id: string | null;
  readonly connector_provider_execution_metadata_json: string | null;
  readonly approval_decision: string | null;
  readonly approval_decided_at: string | null;
  readonly confirmation_token_hash: string | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

function createTestStorage() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-tool-registry-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const storage = createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4o-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4o-mini",
      timeoutMs: null
    }
  });

  const now = new Date().toISOString();
  const connection = new DatabaseSync(databasePath);

  connection.exec("BEGIN");

  try {
    connection
      .prepare(
        `INSERT INTO providers (id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at)
         VALUES ('pro_test_openai', 'openai', 'OpenAI', NULL, 'gpt-4o-mini', 1, NULL, ?, ?)`
      )
      .run(now, now);

    connection
      .prepare(
        `INSERT INTO provider_models (id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at)
         VALUES ('mod_pro_test_openai', 'pro_test_openai', 'gpt-4o-mini', 'gpt-4o-mini', 1, 1, 1, NULL, ?, ?)`
      )
      .run(now, now);

    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    connection.close();
    throw error;
  }

  connection.close();

  return {
    storage,
    databasePath,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function getToolCalls(databasePath: string) {
  const connection = new DatabaseSync(databasePath);

  try {
    return connection
      .prepare(
        `SELECT run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, connector_id, connector_name, connector_account_label, connector_tool_name, connector_provider_tool_id, connector_arguments_summary, connector_approval_policy_json, connector_provider_execution_id, connector_provider_execution_metadata_json, approval_decision, approval_decided_at, confirmation_token_hash, status, error_message, started_at, ended_at
          FROM tool_calls
          ORDER BY started_at ASC`
      )
      .all() as unknown as ToolCallRow[];
  } finally {
    connection.close();
  }
}

test("tool registry persists completed executions", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "hello" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "echo_tool",
          description: "Echoes the provided value.",
          requiresConfirmation: false
        },
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" }
          },
          required: ["value"],
          additionalProperties: false
        } as never,
        async execute(input: unknown) {
          const normalizedInput = input as { value: string };

          return { echoed: normalizedInput.value };
        }
      }
    ]);

    assert.deepEqual(await registry.listTools(), [
      {
        name: "echo_tool",
        description: "Echoes the provided value.",
        requiresConfirmation: false
      }
    ]);

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    });
    const execute = (runtimeTools.echo_tool as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    assert.equal(typeof execute, "function");

    const result = await execute(
      { value: "hello" },
      {
        toolCallId: "call_sdk_1",
        messages: [],
        abortSignal: new AbortController().signal,
        experimental_context: undefined
      }
    );

    assert.deepEqual(result, { echoed: "hello" });

    const [row] = getToolCalls(fixture.databasePath);

    assert.equal(row?.run_id, prepared.runId);
    assert.equal(row?.tool_name, "echo_tool");
    assert.equal(row?.input_json, '{"value":"hello"}');
    assert.equal(row?.output_json, '{"echoed":"hello"}');
    assert.equal(row?.output_truncated, 0);
    assert.equal(row?.output_size_bytes, Buffer.byteLength('{"echoed":"hello"}', "utf8"));
    assert.equal(row?.status, "completed");
    assert.equal(row?.error_message, null);
    assert.equal(Boolean(row?.started_at), true);
    assert.equal(Boolean(row?.ended_at), true);
  } finally {
    fixture.cleanup();
  }
});

test("tool registry persists failed executions", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "fail" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "failing_tool",
          description: "Always fails.",
          requiresConfirmation: false
        },
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" }
          },
          required: ["value"],
          additionalProperties: false
        } as never,
        async execute(_input: unknown) {
          throw new Error("kaboom");
        }
      }
    ]);

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    });
    const execute = (runtimeTools.failing_tool as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    await assert.rejects(
      execute(
        { value: "fail" },
        {
          toolCallId: "call_sdk_2",
          messages: [],
          abortSignal: new AbortController().signal,
          experimental_context: undefined
        }
      ),
      /kaboom/
    );

    const [row] = getToolCalls(fixture.databasePath);

    assert.equal(row?.run_id, prepared.runId);
    assert.equal(row?.tool_name, "failing_tool");
    assert.equal(row?.input_json, '{"value":"fail"}');
    assert.equal(row?.output_json, null);
    assert.equal(row?.status, "failed");
    assert.equal(row?.error_message, "kaboom");
    assert.equal(Boolean(row?.ended_at), true);
  } finally {
    fixture.cleanup();
  }
});

test("tool registry propagates run abort signal into tool executions", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "abort" }] }]
    });
    const runAbortController = new AbortController();
    let observedAbortSignal: AbortSignal | undefined;
    const registry = createToolRegistry([
      {
        metadata: {
          name: "abortable_tool",
          description: "Observes aborts.",
          requiresConfirmation: false
        },
        inputSchema: { type: "object", additionalProperties: false } as never,
        async execute(_input: unknown, context) {
          observedAbortSignal = context.abortSignal;
          runAbortController.abort(new Error("stop_requested"));

          return { aborted: context.abortSignal.aborted };
        }
      }
    ]);

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test"),
      abortSignal: runAbortController.signal
    });
    const execute = (runtimeTools.abortable_tool as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    const output = await execute(
      {},
      {
        toolCallId: "call_sdk_abort_1",
        messages: [],
        experimental_context: undefined
      }
    );

    assert.equal(observedAbortSignal?.aborted, true);
    assert.deepEqual(output, { aborted: true });
  } finally {
    fixture.cleanup();
  }
});

test("tool registry composes static and dynamic tool sources at runtime", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "dynamic" }] }]
    });
    let dynamicEnabled = false;
    const registry = createToolRegistry([], {
      sources: [
        createStaticToolSource("test_static", [
          {
            metadata: {
              name: "static_tool",
              description: "Static tool.",
              requiresConfirmation: false
            },
            inputSchema: { type: "object", additionalProperties: false } as never,
            execute() {
              return { source: "static" };
            }
          }
        ]),
        {
          id: "test_dynamic",
          listTools() {
            return dynamicEnabled
              ? [
                  {
                    name: "dynamic_tool",
                    description: "Dynamic tool.",
                    requiresConfirmation: true
                  }
                ]
              : [];
          },
          resolveTools() {
            return dynamicEnabled
              ? [
                  {
                    metadata: {
                      name: "dynamic_tool",
                      description: "Dynamic tool.",
                      requiresConfirmation: true
                    },
                    inputSchema: { type: "object", additionalProperties: false } as never,
                    execute() {
                      return { source: "dynamic" };
                    }
                  }
                ]
              : [];
          }
        }
      ]
    });

    assert.deepEqual(
      (await registry.listTools()).map((metadata) => metadata.name),
      ["static_tool"]
    );

    dynamicEnabled = true;

    assert.deepEqual(
      (await registry.listTools()).map((metadata) => metadata.name),
      ["static_tool", "dynamic_tool"]
    );

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    });

    assert.equal(typeof (runtimeTools.static_tool as { execute?: unknown }).execute, "function");
    assert.equal(typeof (runtimeTools.dynamic_tool as { execute?: unknown }).execute, "function");
  } finally {
    fixture.cleanup();
  }
});

test("tool registry composes connector tools at runtime and propagates abort signals into provider execution", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "connector runtime" }] }]
    });
    const runAbortController = new AbortController();
    let observedExecutionInput: unknown;
    const provider: ConnectorProvider = {
      async listConnectors() {
        return [];
      },
      async getConnectionStatus(input) {
        return {
          connectorId: input.connectorId,
          state: "connected",
          connected: true,
          account: { accountLabel: "octocat", providerConnectionId: "conn_github_1" }
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
            providerToolId: "GITHUB_GET_A_REPOSITORY",
            name: "GITHUB_GET_A_REPOSITORY",
            displayName: "Get repository",
            description: "Get repository details.",
            inputSchema: {
              type: "object",
              properties: { owner: { type: "string" }, repo: { type: "string" } },
              required: ["owner", "repo"],
              additionalProperties: false
            },
            policy: { sideEffect: "read", approval: "first_use" }
          }
        ];
      },
      async executeTool(input) {
        observedExecutionInput = input;
        return {
          output: { fullName: "monet/connectors", aborted: input.abortSignal.aborted },
          providerExecutionId: "provider-exec-runtime"
        };
      }
    };
    const registry = createToolRegistry(
      [
        {
          metadata: { name: "static_tool", description: "Static tool.", requiresConfirmation: false },
          inputSchema: { type: "object", additionalProperties: false } as never,
          execute() {
            return { source: "static" };
          }
        }
      ],
      { sources: [createConnectorToolSource({ provider })] }
    );
    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test"),
      abortSignal: runAbortController.signal
    });

    assert.equal(typeof (runtimeTools.static_tool as { execute?: unknown }).execute, "function");
    assert.equal(typeof (runtimeTools.github_get_a_repository as { execute?: unknown }).execute, "function");

    runAbortController.abort(new Error("stop_requested"));

    const output = await (runtimeTools.github_get_a_repository as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute(
      { owner: "monet", repo: "connectors" },
      {
        toolCallId: "call_sdk_connector_runtime",
        messages: [],
        experimental_context: undefined
      }
    );

    assert.deepEqual(output, { fullName: "monet/connectors", aborted: true });
    assert.deepEqual(observedExecutionInput, {
      userId: fixture.storage.getMonetInstallId(),
      toolId: "GITHUB_GET_A_REPOSITORY",
      args: { owner: "monet", repo: "connectors" },
      connectionId: "conn_github_1",
      abortSignal: runAbortController.signal
    });

    const [row] = getToolCalls(fixture.databasePath);

    assert.equal(row?.tool_name, "github_get_a_repository");
    assert.equal(row?.connector_id, "github");
    assert.equal(row?.connector_approval_policy_json, '{"sideEffect":"read","approval":"first_use"}');
    assert.equal(row?.connector_provider_execution_id, "provider-exec-runtime");
  } finally {
    fixture.cleanup();
  }
});

test("connector runtime logs redact OAuth codes, tokens, provider API keys, raw arguments, and raw results", async () => {
  const fixture = createTestStorage();
  const previousPretty = process.env.MONET_LOG_PRETTY;
  const previousLevel = process.env.MONET_LOG_LEVEL;
  const previousLog = console.log;
  const previousWarn = console.warn;
  const previousError = console.error;
  const messages: string[] = [];

  process.env.MONET_LOG_PRETTY = "0";
  process.env.MONET_LOG_LEVEL = "debug";
  console.log = (message?: unknown) => {
    messages.push(String(message));
  };
  console.warn = (message?: unknown) => {
    messages.push(String(message));
  };
  console.error = (message?: unknown) => {
    messages.push(String(message));
  };

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "connector logging" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "github_sensitive_tool",
          description: "Connector tool with sensitive inputs and outputs.",
          requiresConfirmation: true,
          connector: {
            connectorId: "github",
            connectorName: "GitHub",
            accountLabel: "octocat",
            toolName: "Sensitive connector tool",
            providerToolId: "GITHUB_SENSITIVE_TOOL",
            approvalPolicy: { sideEffect: "write", approval: "always" }
          }
        },
        inputSchema: { type: "object", additionalProperties: true } as never,
        execute() {
          return {
            ok: true,
            rawResult: "raw-tool-result-secret",
            accessToken: "output-access-token-secret"
          };
        }
      }
    ]);
    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test", { providerApiKey: "provider-api-key-secret" })
    });

    const execute = (runtimeTools.github_sensitive_tool as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    await execute(
      {
        code: "oauth-code-secret",
        accessToken: "input-access-token-secret",
        refresh_token: "input-refresh-token-secret",
        authorization: "Bearer input-bearer-token-secret",
        rawArguments: { query: "raw-tool-argument-secret" }
      },
      {
        toolCallId: "call_sdk_connector_logging",
        messages: [],
        abortSignal: new AbortController().signal,
        experimental_context: undefined
      }
    );
  } finally {
    console.log = previousLog;
    console.warn = previousWarn;
    console.error = previousError;

    if (previousPretty === undefined) {
      delete process.env.MONET_LOG_PRETTY;
    } else {
      process.env.MONET_LOG_PRETTY = previousPretty;
    }

    if (previousLevel === undefined) {
      delete process.env.MONET_LOG_LEVEL;
    } else {
      process.env.MONET_LOG_LEVEL = previousLevel;
    }

    fixture.cleanup();
  }

  const output = messages.join("\n");

  assert.match(output, /connector\.tool\.execution_started/);
  assert.match(output, /connector\.tool\.execution_completed/);
  assert.match(output, /"connectorId":"github"/);
  assert.match(output, /"toolName":"Sensitive connector tool"/);
  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /oauth-code-secret/);
  assert.doesNotMatch(output, /input-access-token-secret/);
  assert.doesNotMatch(output, /input-refresh-token-secret/);
  assert.doesNotMatch(output, /input-bearer-token-secret/);
  assert.doesNotMatch(output, /provider-api-key-secret/);
  assert.doesNotMatch(output, /raw-tool-argument-secret/);
  assert.doesNotMatch(output, /raw-tool-result-secret/);
  assert.doesNotMatch(output, /output-access-token-secret/);
});

test("tool registry persists connector approval metadata for connector tools", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "connector" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "github_list_pull_requests",
          description: "List pull requests.",
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
        },
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            limit: { type: "number" }
          },
          additionalProperties: false
        } as never,
        execute(_input, context) {
          context.setConnectorExecutionMetadata({
            providerExecutionId: "provider-exec-123",
            providerExecutionMetadata: { sessionInfo: { id: "session-1" } }
          });

          return { ok: true };
        }
      }
    ]);

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    });
    const execute = (runtimeTools.github_list_pull_requests as { execute: (input: unknown, context: unknown) => Promise<unknown> })
      .execute;

    await execute(
      { owner: "monet", repo: "connectors", limit: 10 },
      {
        toolCallId: "call_sdk_connector_1",
        messages: [],
        abortSignal: new AbortController().signal,
        experimental_context: undefined
      }
    );

    const [row] = getToolCalls(fixture.databasePath);

    assert.equal(row?.connector_id, "github");
    assert.equal(row?.connector_name, "GitHub");
    assert.equal(row?.connector_account_label, "octocat");
    assert.equal(row?.connector_tool_name, "List pull requests");
    assert.equal(row?.connector_provider_tool_id, "GITHUB_LIST_PULL_REQUESTS");
    assert.equal(row?.connector_arguments_summary, "object(owner:string(length:5),repo:string(length:10),limit:number)");
    assert.equal(row?.connector_approval_policy_json, '{"sideEffect":"read","approval":"first_use"}');
    assert.equal(row?.connector_provider_execution_id, "provider-exec-123");
    assert.equal(row?.connector_provider_execution_metadata_json, '{"sessionInfo":{"id":"session-1"}}');
  } finally {
    fixture.cleanup();
  }
});

test("tool registry redacts tokens and raw authorization headers from persisted tool-call metadata", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "sensitive connector metadata" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "github_sensitive_metadata",
          description: "Persists sensitive connector metadata.",
          requiresConfirmation: false,
          connector: {
            connectorId: "github",
            connectorName: "GitHub",
            accountLabel: "octocat",
            toolName: "Sensitive metadata",
            providerToolId: "GITHUB_SENSITIVE_METADATA",
            approvalPolicy: { sideEffect: "read", approval: "first_use" }
          }
        },
        inputSchema: { type: "object", additionalProperties: true } as never,
        execute(_input, context) {
          context.setConnectorExecutionMetadata({
            providerExecutionId: "provider-exec-safe",
            providerExecutionMetadata: {
              accessToken: "metadata-access-token-secret",
              refresh_token: "metadata-refresh-token-secret",
              providerApiKey: "metadata-provider-api-key-secret",
              authorization: "Bearer metadata-authorization-header-secret",
              callbackUrl: "https://provider.example/callback?access_token=query-access-token-secret&api_key=query-api-key-secret",
              nested: {
                rawAuthorizationHeader: "Bearer nested-authorization-header-secret",
                safeTraceId: "trace_123"
              }
            }
          });

          return { ok: true };
        }
      }
    ]);

    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    });
    const execute = (runtimeTools.github_sensitive_metadata as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    await execute(
      {
        authorization: "Bearer input-authorization-header-secret",
        accessToken: "input-access-token-secret"
      },
      {
        toolCallId: "call_sdk_connector_sensitive_metadata",
        messages: [],
        abortSignal: new AbortController().signal,
        experimental_context: undefined
      }
    );

    const [row] = getToolCalls(fixture.databasePath);
    const persisted = JSON.stringify(row);

    assert.equal(row?.connector_provider_execution_id, "provider-exec-safe");
    assert.match(row?.connector_provider_execution_metadata_json ?? "", /\[redacted\]/);
    assert.match(row?.input_json ?? "", /\[redacted\]/);
    assert.doesNotMatch(persisted, /metadata-access-token-secret/);
    assert.doesNotMatch(persisted, /metadata-refresh-token-secret/);
    assert.doesNotMatch(persisted, /metadata-provider-api-key-secret/);
    assert.doesNotMatch(persisted, /metadata-authorization-header-secret/);
    assert.doesNotMatch(persisted, /query-access-token-secret/);
    assert.doesNotMatch(persisted, /query-api-key-secret/);
    assert.doesNotMatch(persisted, /nested-authorization-header-secret/);
    assert.doesNotMatch(persisted, /input-authorization-header-secret/);
    assert.doesNotMatch(persisted, /input-access-token-secret/);
    assert.match(persisted, /trace_123/);
  } finally {
    fixture.cleanup();
  }
});

test("tool registry fails closed when tool sources collide", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "collision" }] }]
    });
    const collidingDefinition = {
      metadata: {
        name: "same_tool",
        description: "Colliding tool.",
        requiresConfirmation: false
      },
      inputSchema: { type: "object", additionalProperties: false } as never,
      execute() {
        return { ok: true };
      }
    };
    const registry = createToolRegistry([], {
      sources: [
        createStaticToolSource("first", [collidingDefinition]),
        createStaticToolSource("second", [collidingDefinition])
      ]
    });

    await assert.rejects(registry.listTools(), /Tool name collision: same_tool/);
    await assert.rejects(
      registry.createRuntimeTools({
        runId: prepared.runId,
        chatStorage: fixture.storage,
        logger: createLogger("test")
      }),
      /Tool name collision: same_tool/
    );
  } finally {
    fixture.cleanup();
  }
});

test("disconnect cancellation rejects only pending approvals for the disconnected connector", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "pending approvals" }] }]
    });

    fixture.storage.startToolCall({
      toolCallId: "call_github_pending",
      runId: prepared.runId,
      toolName: "github_create_issue",
      input: { title: "issue" },
      metadata: {
        connectorId: "github",
        connectorName: "GitHub",
        connectorAccountLabel: "octocat",
        connectorToolName: "Create issue",
        connectorProviderToolId: "GITHUB_CREATE_ISSUE",
        connectorArgumentsSummary: "object(title:string(length:5))",
        connectorApprovalPolicy: { sideEffect: "write", approval: "always" }
      }
    });
    fixture.storage.recordToolApprovalRequest({ toolCallId: "call_github_pending", confirmationToken: "approve-github" });

    fixture.storage.startToolCall({
      toolCallId: "call_notion_pending",
      runId: prepared.runId,
      toolName: "notion_update_page",
      input: { pageId: "page" },
      metadata: {
        connectorId: "notion",
        connectorName: "Notion",
        connectorAccountLabel: "workspace",
        connectorToolName: "Update page",
        connectorProviderToolId: "NOTION_UPDATE_PAGE",
        connectorArgumentsSummary: "object(pageId:string(length:4))",
        connectorApprovalPolicy: { sideEffect: "write", approval: "always" }
      }
    });
    fixture.storage.recordToolApprovalRequest({ toolCallId: "call_notion_pending", confirmationToken: "approve-notion" });

    assert.equal(fixture.storage.cancelPendingConnectorApprovals({ connectorId: "github" }), 1);

    const rows = getToolCalls(fixture.databasePath);
    const githubRow = rows.find((row) => row.tool_name === "github_create_issue");
    const notionRow = rows.find((row) => row.tool_name === "notion_update_page");

    assert.equal(githubRow?.status, "failed");
    assert.equal(githubRow?.approval_decision, "rejected");
    assert.equal(githubRow?.confirmation_token_hash, null);
    assert.equal(githubRow?.error_message, "Connector disconnected before tool approval was confirmed.");
    assert.equal(Boolean(githubRow?.approval_decided_at), true);
    assert.equal(Boolean(githubRow?.ended_at), true);

    assert.equal(notionRow?.status, "pending");
    assert.equal(notionRow?.approval_decision, null);
    assert.equal(typeof notionRow?.confirmation_token_hash, "string");
    assert.equal(notionRow?.error_message, null);
  } finally {
    fixture.cleanup();
  }
});
