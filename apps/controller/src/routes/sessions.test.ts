import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createChatStorage } from "../chat-storage";
import { createSessionWorkspaceService } from "../session-workspace-service";
import { registerSessionRoutes } from "./sessions";

function createFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-sessions-route-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");

  mkdirSync(workspaceDir, { recursive: true });

  return {
    databasePath,
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

test("create session route rejects malformed JSON bodies", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });

    const response = await app.request("http://127.0.0.1:42831/api/sessions", {
      method: "POST",
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
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });

    const response = await app.request("http://127.0.0.1:42831/api/sessions", {
      method: "POST"
    });

    assert.equal(response.status, 201);

    const session = (await response.json()) as { id: string; title: string | null };
    assert.equal(typeof session.id, "string");
    assert.equal(session.title, "New chat");
    assert.equal(storage.listSessions().length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("delete session route recursively removes the session workspace", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });
    const session = storage.createSession({});
    const workspacePath = await sessionWorkspaceService.ensureWorkspace(session.id);
    const nestedDirectory = join(workspacePath, "nested");
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(nestedDirectory, "hello.txt"), "hello");

    const response = await app.request(`http://127.0.0.1:42831/api/sessions/${session.id}`, {
      method: "DELETE"
    });

    assert.equal(response.status, 204);
    assert.equal(existsSync(workspacePath), false);
    assert.throws(() => storage.getSessionDetail(session.id), /Unknown sessionId/);
  } finally {
    fixture.cleanup();
  }
});

test("open workspace route validates the session and creates its workspace", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });
    const session = storage.createSession({});
    const expectedWorkspacePath = sessionWorkspaceService.getWorkspacePath(session.id);

    assert.equal(existsSync(expectedWorkspacePath), false);

    const response = await app.request(`http://127.0.0.1:42831/api/sessions/${session.id}/workspace/open`, {
      method: "POST"
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      workspacePath: expectedWorkspacePath
    });
    assert.equal(existsSync(expectedWorkspacePath), true);
  } finally {
    fixture.cleanup();
  }
});

test("open workspace route rejects unknown sessions", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });

    const response = await app.request("http://127.0.0.1:42831/api/sessions/ses_missing/workspace/open", {
      method: "POST"
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "not_found",
      message: "Unknown sessionId: ses_missing"
    });
    assert.equal(existsSync(join(fixture.workspaceDir, "ses_missing", "workspace")), false);
  } finally {
    fixture.cleanup();
  }
});

test("open workspace route derives workspace path server-side and ignores renderer paths", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const sessionWorkspaceService = createSessionWorkspaceService({ baseDirectory: fixture.workspaceDir });
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSessionRoutes(app, {
      getChatStorage: () => storage,
      sessionWorkspaceService
    });
    const session = storage.createSession({});
    const rendererSuppliedPath = join(fixture.workspaceDir, "renderer-supplied");
    const expectedWorkspacePath = sessionWorkspaceService.getWorkspacePath(session.id);

    const response = await app.request(`http://127.0.0.1:42831/api/sessions/${session.id}/workspace/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: rendererSuppliedPath })
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json() as { workspacePath: string }).workspacePath, expectedWorkspacePath);
    assert.equal(existsSync(expectedWorkspacePath), true);
    assert.equal(existsSync(rendererSuppliedPath), false);
  } finally {
    fixture.cleanup();
  }
});
