import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createChatStorage } from "../chat-storage";
import { registerSettingsRoutes } from "./settings";

function createFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-settings-route-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const projectDir = join(fixtureDir, "project");
  const docsDir = join(fixtureDir, "docs");

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  return {
    databasePath,
    docsDir,
    projectDir,
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

test("settings routes list and replace authorized directories", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    storage.replaceAuthorizedDirectories([fixture.projectDir]);

    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSettingsRoutes(app, {
      getChatStorage: () => storage
    });

    const listResponse = await app.request("http://127.0.0.1:3030/api/settings/authorized-directories", {
      method: "GET"
    });

    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json()).authorizedDirectories.map((entry: { path: string }) => entry.path), [
      resolve(fixture.projectDir)
    ]);

    const replaceResponse = await app.request("http://127.0.0.1:3030/api/settings/authorized-directories", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paths: [fixture.docsDir, fixture.projectDir]
      })
    });

    assert.equal(replaceResponse.status, 200);
    assert.deepEqual((await replaceResponse.json()).authorizedDirectories.map((entry: { path: string }) => entry.path), [
      resolve(fixture.docsDir),
      resolve(fixture.projectDir)
    ]);
  } finally {
    fixture.cleanup();
  }
});
