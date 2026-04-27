import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
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
        `SELECT run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, connector_id, connector_name, connector_account_label, connector_tool_name, connector_provider_tool_id, connector_arguments_summary, connector_approval_policy_json, connector_provider_execution_id, connector_provider_execution_metadata_json, status, error_message, started_at, ended_at
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
