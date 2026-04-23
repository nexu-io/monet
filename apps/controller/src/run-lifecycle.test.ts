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
    }
  });

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

  const response = await app.request("http://127.0.0.1:3030/api/runs/run_active/stop", {
    method: "POST"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(abortReason, "stop_requested");
});
