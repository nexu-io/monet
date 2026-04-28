import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";

import {
  createChatStreamResponse,
  isExpiredWallClockBudget,
  isToolCallBudgetExhausted,
  resolveStepUsageTokenIncrement,
  resolveObservedRunUsage
} from "./chat-stream";
import { createChatStorage } from "./chat-storage";
import { createLogger } from "./logger";
import { createRunRegistry } from "./run-registry";
import { createSessionWorkspaceService } from "./session-workspace-service";
import { createBuiltinToolDefinitions } from "./tools/builtins";
import { createToolRegistry } from "./tools/registry";
import type { ToolExecutionContext } from "./tools/registry";

interface ToolCallAssertionRow {
  readonly tool_name: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly approval_decision: string | null;
  readonly confirmation_token_hash: string | null;
  readonly status: string;
}

type MockLanguageModelDoStream = Extract<
  NonNullable<NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>["doStream"]>,
  (...args: any[]) => unknown
>;
type MockLanguageModelStreamResult = Awaited<ReturnType<MockLanguageModelDoStream>>;
type MockLanguageModelStreamPart = MockLanguageModelStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

function createChatStreamIntegrationFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-chat-stream-integration-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const sessionWorkspaceBaseDir = join(fixtureDir, "session-workspaces");
  mkdirSync(sessionWorkspaceBaseDir, { recursive: true });

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
    databasePath,
    sessionWorkspaceBaseDir,
    storage,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function getToolCalls(databasePath: string, runId: string) {
  const connection = new DatabaseSync(databasePath);

  try {
    return connection
      .prepare(
        `SELECT tool_name, input_json, output_json, approval_decision, confirmation_token_hash, status
         FROM tool_calls
         WHERE run_id = ?
         ORDER BY started_at ASC`
      )
      .all(runId) as unknown as ToolCallAssertionRow[];
  } finally {
    connection.close();
  }
}

test("resolveObservedRunUsage keeps cumulative run usage from prior continuations", () => {
  assert.deepEqual(
    resolveObservedRunUsage({
      consumedTokens: 42,
      consumedToolCalls: 3
    }),
    {
      consumedTokens: 42,
      consumedToolCalls: 3
    }
  );

  assert.deepEqual(
    resolveObservedRunUsage({
      consumedTokens: -1,
      consumedToolCalls: -1
    }),
    {
      consumedTokens: 0,
      consumedToolCalls: 0
    }
  );
});

test("isExpiredWallClockBudget flags already-expired deadlines before streaming starts", () => {
  const startedAt = Date.parse("2026-01-01T00:01:00.000Z");

  assert.equal(isExpiredWallClockBudget(startedAt - 1, startedAt), true);
  assert.equal(isExpiredWallClockBudget(startedAt, startedAt), true);
  assert.equal(isExpiredWallClockBudget(startedAt + 1, startedAt), false);
  assert.equal(isExpiredWallClockBudget(Number.NaN, startedAt), false);
});

test("isToolCallBudgetExhausted aborts once the configured tool-call limit is reached", () => {
  assert.equal(isToolCallBudgetExhausted(0, 1), false);
  assert.equal(isToolCallBudgetExhausted(1, 1), true);
  assert.equal(isToolCallBudgetExhausted(2, 1), true);
});

test("resolveStepUsageTokenIncrement handles cumulative and per-step usage reports", () => {
  assert.equal(resolveStepUsageTokenIncrement(0, 10), 10);
  assert.equal(resolveStepUsageTokenIncrement(10, 25), 15);
  assert.equal(resolveStepUsageTokenIncrement(25, 8), 8);
  assert.equal(resolveStepUsageTokenIncrement(25, 0), 0);
});

test("chat stream threads session workspace context into runtime tools", async () => {
  let capturedToolContext: ToolExecutionContext | undefined;
  let ensuredSessionId: string | undefined;

  await assert.rejects(
    createChatStreamResponse({
      request: {
        sessionId: "ses_chatstreamtest",
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        runId: "run_chatstreamtest",
        maxSteps: 1,
        maxTokensPerRun: null,
        wallClockDeadlineAt: null
      },
      messages: [],
      chatStorage: {} as never,
      providerRuntime: {
        async createChatModel() {
          throw new Error("stop before model streaming");
        }
      } as never,
      runRegistry: {
        register() {
          return () => {};
        }
      } as never,
      sessionWorkspaceService: {
        baseDirectory: "/tmp/monet-test-session-workspaces",
        getWorkspacePath(sessionId: string) {
          return `/tmp/monet-test-session-workspaces/${sessionId}/workspace`;
        },
        async ensureWorkspace(sessionId: string) {
          ensuredSessionId = sessionId;
          return this.getWorkspacePath(sessionId);
        },
        async deleteWorkspace() {},
        async cleanupOrphanWorkspaces() {
          return { scannedCount: 0, deletedCount: 0, skippedCount: 0 };
        },
        async listWorkspaceMetadata(sessionId: string) {
          return {
            sessionId,
            workspacePath: this.getWorkspacePath(sessionId),
            exists: false,
            fileCount: 0,
            directoryCount: 0,
            sizeBytes: 0,
            updatedAt: null
          };
        }
      },
      toolRegistry: {
        registerSource() {},
        async listTools() {
          return [];
        },
        register() {},
        async resolveTools() {
          return [];
        },
        async createRuntimeTools(context: ToolExecutionContext) {
          capturedToolContext = context;
          return {};
        }
      },
      runtime: {
        maxStepsPerRun: 1,
        maxTokensPerRun: 1_000,
        wallClockBudgetMs: 30_000,
        maxToolCallsPerRun: 1
      },
      logger: createLogger("test"),
      requestSignal: new AbortController().signal
    }),
    /stop before model streaming/
  );

  assert.equal(ensuredSessionId, "ses_chatstreamtest");
  assert.equal(capturedToolContext?.runId, "run_chatstreamtest");
  assert.equal(capturedToolContext?.sessionId, "ses_chatstreamtest");
  assert.equal(
    capturedToolContext?.sessionWorkspacePath,
    "/tmp/monet-test-session-workspaces/ses_chatstreamtest/workspace"
  );
});

test("new session can write hello.html in its workspace without authorized directories or confirmation", async () => {
  const fixture = createChatStreamIntegrationFixture();

  try {
    const htmlContent = "<!doctype html><html><body>Hello from Monet</body></html>";
    const prepared = fixture.storage.prepareChatRequest({
      messages: [
        {
          id: "msg_user_hello_html",
          role: "user",
          parts: [{ type: "text", text: "Create hello.html" }]
        }
      ],
      maxSteps: 1,
      maxTokensPerRun: null,
      wallClockDeadlineAt: null
    });
    const sessionWorkspaceService = createSessionWorkspaceService({
      baseDirectory: fixture.sessionWorkspaceBaseDir
    });
    const toolRegistry = createToolRegistry(
      createBuiltinToolDefinitions({
        allowedDirectories: []
      })
    );
    const modelStreamParts = [
      { type: "stream-start" as const, warnings: [] },
      {
        type: "tool-call" as const,
        toolCallId: "call_write_hello_html",
        toolName: "write_file",
        input: JSON.stringify({
          path: "hello.html",
          content: htmlContent
        })
      },
      {
        type: "finish" as const,
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: {
            total: 1,
            text: 1,
            reasoning: undefined
          }
        }
      }
    ] satisfies MockLanguageModelStreamPart[];
    const modelStreamResult: MockLanguageModelStreamResult = {
      stream: convertArrayToReadableStream(modelStreamParts)
    };
    const model = new MockLanguageModelV3({
      doStream: modelStreamResult
    });

    const response = await createChatStreamResponse({
      request: prepared,
      messages: [
        {
          id: "msg_user_hello_html",
          role: "user",
          parts: [{ type: "text", text: "Create hello.html" }]
        }
      ],
      chatStorage: fixture.storage,
      providerRuntime: {
        async createChatModel() {
          return model;
        }
      } as never,
      runRegistry: createRunRegistry(),
      sessionWorkspaceService,
      toolRegistry,
      runtime: {
        maxStepsPerRun: 1,
        maxTokensPerRun: 32_768,
        maxToolCallsPerRun: 1,
        wallClockBudgetMs: 30_000
      },
      logger: createLogger("test"),
      requestSignal: new AbortController().signal
    });

    await response.text();

    const workspacePath = sessionWorkspaceService.getWorkspacePath(prepared.sessionId);
    const helloPath = join(workspacePath, "hello.html");
    assert.equal(readFileSync(helloPath, "utf8"), htmlContent);

    const run = fixture.storage.getRunContext(prepared.runId);
    assert.equal(run.status, "completed");
    assert.equal(run.sessionId, prepared.sessionId);
    assert.equal(run.consumedToolCalls, 1);

    const toolCalls = getToolCalls(fixture.databasePath, prepared.runId);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.tool_name, "write_file");
    assert.equal(toolCalls[0]?.status, "completed");
    assert.equal(toolCalls[0]?.approval_decision, null);
    assert.equal(toolCalls[0]?.confirmation_token_hash, null);
    assert.match(toolCalls[0]?.input_json ?? "", /hello\.html/);
    assert.match(toolCalls[0]?.output_json ?? "", /session_workspace/);
    assert.match(toolCalls[0]?.output_json ?? "", /"requiresConfirmation":false/);
  } finally {
    fixture.cleanup();
  }
});
