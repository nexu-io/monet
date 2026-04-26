import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ChatStorageResolutionError, createChatStorage } from "./chat-storage";

function createStorageFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-chat-storage-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");
  const secondaryDir = join(fixtureDir, "secondary");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(secondaryDir, { recursive: true });

  return {
    databasePath,
    fixtureDir,
    secondaryDir,
    workspaceDir,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function createStorage(databasePath: string) {
  return createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    }
  });
}

function seedRuntimeProviders(databasePath: string, options: { openaiDefaultModel: string; openrouterDefaultModel: string }) {
  const now = new Date().toISOString();
  const connection = new DatabaseSync(databasePath);

  try {
    connection.exec("BEGIN");

    try {
      const openaiProviderId = "pro_test_openai";
      const openrouterProviderId = "pro_test_openrouter";

      connection
        .prepare(
          `INSERT INTO providers (id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at)
           VALUES (?, 'openai', 'OpenAI', NULL, ?, 1, NULL, ?, ?)`
        )
        .run(openaiProviderId, options.openaiDefaultModel, now, now);

      connection
        .prepare(
          `INSERT INTO provider_models (id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 1, 1, NULL, ?, ?)`
        )
        .run(`mod_${openaiProviderId}`, openaiProviderId, options.openaiDefaultModel, options.openaiDefaultModel, now, now);

      connection
        .prepare(
          `INSERT INTO providers (id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at)
           VALUES (?, 'openrouter', 'OpenRouter', NULL, ?, 1, NULL, ?, ?)`
        )
        .run(openrouterProviderId, options.openrouterDefaultModel, now, now);

      connection
        .prepare(
          `INSERT INTO provider_models (id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 0, 1, NULL, ?, ?)`
        )
        .run(`mod_${openrouterProviderId}`, openrouterProviderId, options.openrouterDefaultModel, options.openrouterDefaultModel, now, now);

      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  } finally {
    connection.close();
  }
}

function createStorageWithRuntimeData(databasePath: string) {
  const storage = createStorage(databasePath);
  seedRuntimeProviders(databasePath, {
    openaiDefaultModel: "gpt-4.1-mini",
    openrouterDefaultModel: "openai/gpt-4.1-mini"
  });

  return storage;
}

test("authorized directory allowlist persists across storage reopen", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const saved = storage.replaceAuthorizedDirectories([
      fixture.workspaceDir,
      `${fixture.workspaceDir}/../workspace`,
      fixture.secondaryDir,
      "   "
    ]);

    assert.deepEqual(
      saved.map((entry) => entry.path),
      [resolve(fixture.secondaryDir), resolve(fixture.workspaceDir)]
    );

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(
      reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path),
      [resolve(fixture.secondaryDir), resolve(fixture.workspaceDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("storage has no runtime provider/model bootstrap by default", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const providers = storage.listProviders();

    assert.deepEqual(providers, []);
  } finally {
    fixture.cleanup();
  }
});

test("persisted tool outputs are truncated for oversized or file-like payloads", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const prepared = storage.prepareChatRequest({
      messages: [
        {
          id: "msg_user_1",
          role: "user",
          parts: [{ type: "text", text: "Read the file." }]
        } as any,
        {
          id: "msg_assistant_1",
          role: "assistant",
          parts: [
            {
              type: "tool-read_file",
              toolName: "read_file",
              state: "output-available",
              output: {
                content: "x".repeat(20_000)
              }
            }
          ]
        } as any
      ]
    });
    const detail = storage.getSessionDetail(prepared.sessionId);
    const assistantMessage = detail.messages.find((message) => message.id === "msg_assistant_1");
    const persistedUiMessage = assistantMessage?.uiMessage as { parts?: unknown[] } | undefined;
    const toolPart = persistedUiMessage?.parts?.find(
      (part) => typeof (part as { type?: unknown }).type === "string" && (part as { type: string }).type === "tool-read_file"
    ) as { output?: { truncated?: boolean; preview?: string } } | undefined;

    assert.equal(toolPart?.output?.truncated, true);
    assert.ok((toolPart?.output?.preview?.length ?? 0) > 0);
  } finally {
    fixture.cleanup();
  }
});

test("stored typed tool parts remain renderable when toolName is omitted", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const prepared = storage.prepareChatRequest({
      messages: [
        {
          id: "msg_user_fetch",
          role: "user",
          parts: [{ type: "text", text: "Summarize a URL." }]
        } as any,
        {
          id: "msg_assistant_fetch",
          role: "assistant",
          parts: [
            {
              type: "tool-fetch_url",
              state: "output-available",
              input: { url: "https://paulgraham.com/google.html" },
              output: {
                content: "Fetched content"
              }
            }
          ]
        } as any
      ]
    });
    const detail = storage.getSessionDetail(prepared.sessionId);
    const assistantMessage = detail.messages.find((message) => message.id === "msg_assistant_fetch");
    const persistedUiMessage = assistantMessage?.uiMessage as { parts?: unknown[] } | undefined;
    const toolPart = persistedUiMessage?.parts?.[0] as { type?: string; output?: { toolName?: string; truncated?: boolean } } | undefined;

    assert.equal(toolPart?.type, "tool-fetch_url");
    assert.equal(toolPart?.output?.toolName, "fetch_url");
    assert.equal(toolPart?.output?.truncated, true);
  } finally {
    fixture.cleanup();
  }
});

test("message upserts preserve the original run linkage for existing idempotency keys", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const initial = storage.prepareChatRequest({
      messages: [
        {
          id: "msg_shared",
          role: "user",
          parts: [{ type: "text", text: "Initial prompt" }]
        } as any
      ]
    });

    const continued = storage.prepareChatRequest({
      sessionId: initial.sessionId,
      messages: [
        {
          id: "msg_shared",
          role: "user",
          parts: [{ type: "text", text: "Initial prompt with refreshed payload" }]
        } as any
      ]
    });

    const connection = new DatabaseSync(fixture.databasePath);

    try {
      const row = connection
        .prepare("SELECT run_id, ui_message_json FROM messages WHERE session_id = ? AND idempotency_key = ?")
        .get(initial.sessionId, "msg_shared") as { run_id: string | null; ui_message_json: string } | undefined;

      assert.equal(row?.run_id, initial.runId);
      assert.notEqual(continued.runId, initial.runId);
      assert.match(row?.ui_message_json ?? "", /refreshed payload/);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("message upserts reuse existing row ids when UI message ids collide", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const initial = storage.prepareChatRequest({
      messages: [
        {
          id: "msg_shared",
          role: "user",
          parts: [{ type: "text", text: "Initial prompt" }]
        } as any
      ]
    });
    const connection = new DatabaseSync(fixture.databasePath);

    try {
      connection.prepare("UPDATE messages SET id = ? WHERE session_id = ? AND idempotency_key = ?").run("msg_legacy_row", initial.sessionId, "msg_shared");
      connection
        .prepare(
          `INSERT INTO messages (id, session_id, run_id, role, ui_message_json, ui_message_schema_version, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "msg_shared",
          initial.sessionId,
          initial.runId,
          "user",
          JSON.stringify({ id: "msg_other", role: "user", parts: [{ type: "text", text: "Other prompt" }] }),
          "v1",
          "msg_other",
          new Date().toISOString()
        );
    } finally {
      connection.close();
    }

    assert.doesNotThrow(() =>
      storage.prepareChatRequest({
        sessionId: initial.sessionId,
        messages: [
          {
            id: "msg_shared",
            role: "user",
            parts: [{ type: "text", text: "Initial prompt retried" }]
          } as any
        ]
      })
    );
  } finally {
    fixture.cleanup();
  }
});

test("prepareChatRequest rejects archived sessions before creating a new run", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const initial = storage.prepareChatRequest({
      messages: [
        {
          id: "msg_user_1",
          role: "user",
          parts: [{ type: "text", text: "Archive this session." }]
        } as any
      ]
    });

    storage.archiveSession(initial.sessionId);

    assert.throws(
      () =>
        storage.prepareChatRequest({
          sessionId: initial.sessionId,
          messages: [
            {
              id: "msg_user_2",
              role: "user",
              parts: [{ type: "text", text: "This should be rejected." }]
            } as any
          ]
        }),
      (error) => {
        assert.ok(error instanceof ChatStorageResolutionError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.errorCode, "invalid_state");
        assert.equal(error.message, `Session is archived: ${initial.sessionId}`);
        return true;
      }
    );

    const connection = new DatabaseSync(fixture.databasePath);

    try {
      const runCount = connection
        .prepare("SELECT COUNT(*) AS count FROM runs WHERE session_id = ?")
        .get(initial.sessionId) as { count: number };

      assert.equal(runCount.count, 1);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("prepareChatRequest rejects invalid fallback provider/model before persisting a run", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorageWithRuntimeData(fixture.databasePath);
    const connection = new DatabaseSync(fixture.databasePath);

    try {
      connection
        .prepare("UPDATE provider_models SET enabled = 0")
        .run();

      assert.throws(
        () =>
          storage.prepareChatRequest({
            messages: [
              {
                id: "msg_user_1",
                role: "user",
                parts: [{ type: "text", text: "Hello" }]
              } as any
            ]
          }),
        (error) => {
          assert.ok(error instanceof ChatStorageResolutionError);
          assert.equal(error.statusCode, 422);
          assert.equal(error.errorCode, "provider_model_unresolved");
          assert.equal(error.message, "No fallback provider/model is currently available for new chats.");
          return true;
        }
      );

      const runCount = connection.prepare("SELECT COUNT(*) AS count FROM runs").get() as { count: number };
      const messageCount = connection.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };

      assert.equal(runCount.count, 0);
      assert.equal(messageCount.count, 0);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});
