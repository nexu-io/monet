import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatStreamResponse,
  isExpiredWallClockBudget,
  isToolCallBudgetExhausted,
  resolveObservedRunUsage
} from "./chat-stream";
import { createLogger } from "./logger";
import type { ToolExecutionContext } from "./tools/registry";

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
        listTools() {
          return [];
        },
        register() {},
        createRuntimeTools(context: ToolExecutionContext) {
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
