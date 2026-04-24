import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createChatStorage } from "./chat-storage";
import { createFetchWithTimeout, createProviderRuntime } from "./provider-runtime";

function createFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-provider-runtime-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const storage = createChatStorage({
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

  return {
    storage,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

test("validateProvider reports missing OpenRouter credentials", async () => {
  const fixture = createFixture();

  try {
    const provider = fixture.storage.listProviders().find((entry) => entry.type === "openrouter");

    assert.ok(provider);

    const runtime = createProviderRuntime({
      getChatStorage: () => fixture.storage,
      openai: {
        apiKey: null,
        baseUrl: null,
        defaultModel: "gpt-4.1-mini",
        timeoutMs: null
      },
      openrouter: {
        apiKey: null,
        baseUrl: null,
        defaultModel: "openai/gpt-4.1-mini",
        timeoutMs: null
      }
    });

    const validation = await runtime.validateProvider(provider.id);

    assert.equal(validation.valid, false);
    assert.equal(validation.reason, "missing_credentials");
    assert.equal(validation.message, "OpenRouter API key is not configured.");
  } finally {
    fixture.cleanup();
  }
});

test("syncProviderCatalog loads OpenRouter models via OpenAI-compatible API", async () => {
  const fixture = createFixture();
  const provider = fixture.storage.listProviders().find((entry) => entry.type === "openrouter");

  assert.ok(provider);

  const runtime = createProviderRuntime({
    getChatStorage: () => fixture.storage,
    openai: {
      apiKey: null,
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      apiKey: "or-test-key",
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    }
  });

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://openrouter.ai/api/v1/models");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer or-test-key");

    return new Response(
      JSON.stringify({
        data: [
          { id: "openai/gpt-4.1-mini" },
          { id: "anthropic/claude-3.7-sonnet" },
          { id: "google/gemini-2.5-flash" },
          { id: "text-embedding-3-small" }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  };

  try {
    await runtime.syncProviderCatalog(provider.id);

    const models = fixture.storage.listModels(provider.id);

    assert.deepEqual(
      models.map((model) => model.modelName),
      ["anthropic/claude-3.7-sonnet", "google/gemini-2.5-flash", "openai/gpt-4.1-mini"]
    );

    const validation = await runtime.validateProvider(provider.id);

    assert.equal(validation.valid, true);
    assert.equal(validation.defaultModelName, "openai/gpt-4.1-mini");
    assert.ok(validation.defaultModelId);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});

test("createFetchWithTimeout enforces a fallback timeout when config is unset", async () => {
  const fetchWithTimeout = createFetchWithTimeout(null, 5);
  let aborted = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(init.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    });
  };

  try {
    await assert.rejects(
      fetchWithTimeout("https://example.com/models", {
        method: "GET"
      }),
      /Request timed out after 5ms/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(aborted, true);
});
