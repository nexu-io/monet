import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "./app";
import type { ChatStorage } from "./chat-storage";
import { createChatStorage } from "./chat-storage";
import { createRunRegistry } from "./run-registry";
import { registerRunRoutes } from "./routes/runs";

const noopProviderRuntime = {
  createChatModel() {
    throw new Error("not used in stop test");
  }
};

const noopToolRegistry = {
  listTools() {
    return [] as const;
  },
  register() {
    throw new Error("not used in stop test");
  },
  createRuntimeTools() {
    return {};
  }
};

interface StoredRunRow {
  readonly status: string;
  readonly finish_reason: string | null;
  readonly ended_at: string | null;
}

function createTestStorage() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-controller-tests-"));
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

function getRunRow(databasePath: string, runId: string) {
  const connection = new DatabaseSync(databasePath);

  try {
    return connection
      .prepare("SELECT status, finish_reason, ended_at FROM runs WHERE id = ?")
      .get(runId) as StoredRunRow | undefined;
  } finally {
    connection.close();
  }
}

test("startup recovery marks running runs interrupted and pending runs failed", () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [
        {
          id: "msg_running",
          role: "user",
          parts: [{ type: "text", text: "hello" }]
        }
      ]
    });

    const pendingRunId = "run_pending_recovery";
    const connection = new DatabaseSync(fixture.databasePath);

    connection
      .prepare(
        `INSERT INTO runs (
          id,
          session_id,
          status,
          provider_id,
          model_id,
          current_step,
          max_steps,
          max_tokens_per_run,
          wall_clock_deadline_at,
          finish_reason,
          started_at,
          ended_at
        ) VALUES (?, ?, 'pending', ?, ?, 0, 1, NULL, NULL, NULL, ?, NULL)`
      )
      .run(
        pendingRunId,
        prepared.sessionId,
        prepared.providerId,
        prepared.modelId,
        new Date().toISOString()
      );

    connection.close();

    const recovered = fixture.storage.recoverUnfinishedRuns();

    assert.deepEqual(recovered.interruptedRunIds, [prepared.runId]);
    assert.deepEqual(recovered.failedRunIds, [pendingRunId]);

    const recoveredRunning = getRunRow(fixture.databasePath, prepared.runId);
    const recoveredPending = getRunRow(fixture.databasePath, pendingRunId);

    assert.equal(recoveredRunning?.status, "interrupted");
    assert.equal(recoveredRunning?.finish_reason, "startup_recovery");
    assert.equal(Boolean(recoveredRunning?.ended_at), true);

    assert.equal(recoveredPending?.status, "failed");
    assert.equal(recoveredPending?.finish_reason, "startup_recovery");
    assert.equal(Boolean(recoveredPending?.ended_at), true);
  } finally {
    fixture.cleanup();
  }
});

test("run progress persists cumulative token and tool-call usage across continuations", () => {
  const fixture = createTestStorage();

  try {
    const prepared = fixture.storage.prepareChatRequest({
      messages: [
        {
          id: "msg_usage",
          role: "user",
          parts: [{ type: "text", text: "hello" }]
        }
      ]
    });

    fixture.storage.updateRunProgress({
      runId: prepared.runId,
      currentStep: 1,
      consumedTokens: 123,
      consumedToolCalls: 2
    });

    const run = fixture.storage.getRunContext(prepared.runId);

    assert.equal(run.currentStep, 1);
    assert.equal(run.consumedTokens, 123);
    assert.equal(run.consumedToolCalls, 2);
  } finally {
    fixture.cleanup();
  }
});

test("stop endpoint returns ok for an active run", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  const runRegistry = createRunRegistry();
  let abortReason: string | null = null;

  runRegistry.register("run_active", {
    abort(reason) {
      abortReason = reason;
    }
  });

  registerRunRoutes(app, {
    runRegistry,
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 1,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 1,
      wallClockBudgetMs: 30_000
    },
    getChatStorage: () =>
      ({
        interruptRun() {
          throw new Error("active run should be stopped via registry");
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:42831/api/runs/run_active/stop", {
    method: "POST"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(abortReason, "stop_requested");
});

test("continue endpoint rejects requests without messages", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let confirmCalled = false;

  registerRunRoutes(app, {
    runRegistry: createRunRegistry(),
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 1,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 1,
      wallClockBudgetMs: 30_000
    },
    getChatStorage: () =>
      ({
        confirmToolCall() {
          confirmCalled = true;
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:42831/api/runs/run_pending/continue", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      runId: "run_pending",
      toolCallId: "tool_123",
      decision: "approved",
      confirmationToken: "confirm_123"
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_request",
    message: "Request validation failed."
  });
  assert.equal(confirmCalled, false);
});

test("continue endpoint rejects runs that have exhausted their max-step budget", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let persistCalled = false;
  let resumeCalled = false;

  registerRunRoutes(app, {
    runRegistry: createRunRegistry(),
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 1,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 1,
      wallClockBudgetMs: 30_000
    },
    getChatStorage: () =>
      ({
        confirmToolCall() {},
        getRunContext() {
          return {
            status: "pending",
            sessionId: "session_123",
            providerId: "openai",
            modelId: "gpt-4o-mini",
            currentStep: 1,
            consumedTokens: 0,
            consumedToolCalls: 0,
            maxSteps: 1,
            maxTokensPerRun: null,
            wallClockDeadlineAt: null
          };
        },
        persistRunMessages() {
          persistCalled = true;
        },
        resumeRun() {
          resumeCalled = true;
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:42831/api/runs/run_pending/continue", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      runId: "run_pending",
      toolCallId: "tool_123",
      decision: "approved",
      confirmationToken: "confirm_123",
      messages: [
        {
          id: "msg_user",
          role: "user",
          parts: [{ type: "text", text: "continue" }]
        }
      ]
    })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "invalid_state",
    message: "Run has exhausted its max-step budget."
  });
  assert.equal(persistCalled, false);
  assert.equal(resumeCalled, false);
});

test("continue endpoint rejects when a pending run cannot be resumed", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let persistCalled = false;
  let resumeCalled = false;

  registerRunRoutes(app, {
    runRegistry: createRunRegistry(),
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 2,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 1,
      wallClockBudgetMs: 30_000
    },
    getChatStorage: () =>
      ({
        confirmToolCall() {},
        getRunContext() {
          return {
            status: "pending",
            sessionId: "session_123",
            providerId: "openai",
            modelId: "gpt-4o-mini",
            currentStep: 1,
            consumedTokens: 0,
            consumedToolCalls: 0,
            maxSteps: 2,
            maxTokensPerRun: null,
            wallClockDeadlineAt: null
          };
        },
        persistRunMessages() {
          persistCalled = true;
        },
        resumeRun() {
          resumeCalled = true;
          return false;
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:42831/api/runs/run_pending/continue", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      runId: "run_pending",
      toolCallId: "tool_123",
      decision: "approved",
      confirmationToken: "confirm_123",
      messages: [
        {
          id: "msg_user",
          role: "user",
          parts: [{ type: "text", text: "continue" }]
        }
      ]
    })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "invalid_state",
    message: "Run is not awaiting continuation."
  });
  assert.equal(persistCalled, true);
  assert.equal(resumeCalled, true);
});
