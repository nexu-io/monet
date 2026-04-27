import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import { createLogger, type Logger } from "../logger";
import { createToolRegistry } from "./registry";

interface ToolCallRow {
  readonly run_id: string;
  readonly tool_name: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly output_truncated: number;
  readonly output_size_bytes: number | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

interface CapturedLogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly context: Record<string, unknown> | undefined;
}

function createCapturingLogger(entries: CapturedLogEntry[]): Logger {
  return {
    child() {
      return createCapturingLogger(entries);
    },
    debug(event, context) {
      entries.push({ level: "debug", event, context });
    },
    info(event, context) {
      entries.push({ level: "info", event, context });
    },
    warn(event, context) {
      entries.push({ level: "warn", event, context });
    },
    error(event, _error, context) {
      entries.push({ level: "error", event, context });
    }
  };
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
        `SELECT run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, status, error_message, started_at, ended_at
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
        async execute(input: unknown, context) {
          const normalizedInput = input as { value: string };

          return {
            echoed: normalizedInput.value,
            sessionId: context.sessionId,
            sessionWorkspacePath: context.sessionWorkspacePath
          };
        }
      }
    ]);

    assert.deepEqual(registry.listTools(), [
      {
        name: "echo_tool",
        description: "Echoes the provided value.",
        requiresConfirmation: false
      }
    ]);

    const runtimeTools = registry.createRuntimeTools({
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      sessionWorkspacePath: "/tmp/monet-test-session-workspace",
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

    assert.deepEqual(result, {
      echoed: "hello",
      sessionId: prepared.sessionId,
      sessionWorkspacePath: "/tmp/monet-test-session-workspace"
    });

    const [row] = getToolCalls(fixture.databasePath);

    assert.equal(row?.run_id, prepared.runId);
    assert.equal(row?.tool_name, "echo_tool");
    assert.equal(row?.input_json, '{"value":"hello"}');
    assert.equal(
      row?.output_json,
      `{"echoed":"hello","sessionId":"${prepared.sessionId}","sessionWorkspacePath":"/tmp/monet-test-session-workspace"}`
    );
    assert.equal(row?.output_truncated, 0);
    assert.equal(row?.output_size_bytes, Buffer.byteLength(row?.output_json ?? "", "utf8"));
    assert.equal(row?.status, "completed");
    assert.equal(row?.error_message, null);
    assert.equal(Boolean(row?.started_at), true);
    assert.equal(Boolean(row?.ended_at), true);
  } finally {
    fixture.cleanup();
  }
});

test("tool registry logs filesystem path metadata from tool output", async () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "hello" }] }]
    });
    const registry = createToolRegistry([
      {
        metadata: {
          name: "path_tool",
          description: "Returns filesystem path metadata.",
          requiresConfirmation: true
        },
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"],
          additionalProperties: false
        } as never,
        async execute(input: unknown) {
          const normalizedInput = input as { path: string };

          return {
            path: "/tmp/session-workspace/output.txt",
            requestedPath: normalizedInput.path,
            resolvedPath: "/tmp/session-workspace/output.txt",
            pathZone: "session_workspace",
            requiresConfirmation: false,
            bytesWritten: 5
          };
        }
      }
    ]);
    const logEntries: CapturedLogEntry[] = [];
    const runtimeTools = registry.createRuntimeTools({
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      sessionWorkspacePath: "/tmp/monet-test-session-workspace",
      chatStorage: fixture.storage,
      logger: createCapturingLogger(logEntries)
    });
    const execute = (runtimeTools.path_tool as { execute: (input: unknown, context: unknown) => Promise<unknown> }).execute;

    await execute(
      { path: "output.txt" },
      {
        toolCallId: "call_sdk_path",
        messages: [],
        abortSignal: new AbortController().signal,
        experimental_context: undefined
      }
    );

    const completedLog = logEntries.find((entry) => entry.event === "tool.execution_completed");

    assert.equal(completedLog?.context?.requestedPath, "output.txt");
    assert.equal(completedLog?.context?.resolvedPath, "/tmp/session-workspace/output.txt");
    assert.equal(completedLog?.context?.pathZone, "session_workspace");
    assert.equal(completedLog?.context?.requiresConfirmation, false);
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

    const runtimeTools = registry.createRuntimeTools({
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      sessionWorkspacePath: "/tmp/monet-test-session-workspace",
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
