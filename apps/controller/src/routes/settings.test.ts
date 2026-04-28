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

    const listResponse = await app.request("http://127.0.0.1:42831/api/settings/authorized-directories", {
      method: "GET"
    });

    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json()).authorizedDirectories.map((entry: { path: string }) => entry.path), [
      resolve(fixture.projectDir)
    ]);

    const replaceResponse = await app.request("http://127.0.0.1:42831/api/settings/authorized-directories", {
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

test("settings routes expose and replace composio provider settings", async () => {
  const fixture = createFixture();

  try {
    const storage = createStorage(fixture.databasePath);

    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
    registerSettingsRoutes(app, {
      getChatStorage: () => storage
    });

    const listResponse = await app.request("http://127.0.0.1:42831/api/settings/connectors/composio", {
      method: "GET"
    });
    const listBody = (await listResponse.json()) as {
      key: string;
      provider: "composio";
      apiKeyConfigured: boolean;
      baseUrl: string;
      timeoutMs: number | null;
      authConfigIds: Record<string, string>;
      updatedAt: string;
    };

    assert.equal(listResponse.status, 200);
    assert.deepEqual(listBody, {
      key: "connector_provider_composio",
      provider: "composio",
      apiKeyConfigured: false,
      baseUrl: "https://backend.composio.dev",
      timeoutMs: null,
      authConfigIds: {},
      updatedAt: listBody.updatedAt
    });

    const replaceResponse = await app.request("http://127.0.0.1:42831/api/settings/connectors/composio", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        apiKey: "  my-key  ",
        baseUrl: "https://composio.custom.test/",
        timeoutMs: 5000,
        authConfigIds: {
          github: "gh-auth-id",
          notion: "ntion-id"
        }
      })
    });
    const replaceBody = (await replaceResponse.json()) as {
      key: string;
      provider: "composio";
      apiKeyConfigured: boolean;
      baseUrl: string;
      timeoutMs: number | null;
      authConfigIds: Record<string, string>;
      updatedAt: string;
    };

    assert.equal(replaceResponse.status, 200);
    assert.deepEqual(replaceBody, {
      key: "connector_provider_composio",
      provider: "composio",
      apiKeyConfigured: true,
      baseUrl: "https://composio.custom.test",
      timeoutMs: 5000,
      authConfigIds: {
        github: "gh-auth-id",
        notion: "ntion-id"
      },
      updatedAt: replaceBody.updatedAt
    });

    const partialReplaceResponse = await app.request("http://127.0.0.1:42831/api/settings/connectors/composio", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timeoutMs: 7500
      })
    });
    const partialReplaceBody = (await partialReplaceResponse.json()) as {
      authConfigIds: Record<string, string>;
      timeoutMs: number | null;
    };

    assert.equal(partialReplaceResponse.status, 200);
    assert.equal(partialReplaceBody.timeoutMs, 7500);
    assert.deepEqual(partialReplaceBody.authConfigIds, {
      github: "gh-auth-id",
      notion: "ntion-id"
    });
  } finally {
    fixture.cleanup();
  }
});
