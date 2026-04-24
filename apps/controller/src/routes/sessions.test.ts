import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createChatStorage } from "../chat-storage";
import { registerSessionRoutes } from "./sessions";

function createFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-sessions-route-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");

  mkdirSync(workspaceDir, { recursive: true });

  return {
    databasePath,
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

test("create session route rejects malformed JSON bodies", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage
    });

    const response = await app.request("http://127.0.0.1:3030/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{"
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "Malformed JSON request body."
    });
    assert.equal(storage.listSessions().length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("create session route accepts an empty body", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage
    });

    const response = await app.request("http://127.0.0.1:3030/api/sessions", {
      method: "POST"
    });

    assert.equal(response.status, 201);

    const session = (await response.json()) as { id: string; title: string | null };
    assert.equal(typeof session.id, "string");
    assert.equal(session.title, null);
    assert.equal(storage.listSessions().length, 1);
  } finally {
    fixture.cleanup();
  }
});
