import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import { createControllerApp, type ControllerApp, type ControllerAppVariables } from "../app";
import { createChatStorage, type ChatStorage } from "../chat-storage";
import { LIVE_ARTIFACT_REFRESH_PHASE_GATE, registerLiveArtifactRoutes } from "./live-artifacts";

function createStorageFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-live-artifacts-route-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");
  const sessionWorkspaceBaseDirectory = join(fixtureDir, "session-workspaces");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(sessionWorkspaceBaseDirectory, { recursive: true });

  return {
    databasePath,
    fixtureDir,
    sessionWorkspaceBaseDirectory,
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

function createRouteApp(storage: ChatStorage) {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>({
    defaultHook(result, context) {
      if (result.success) {
        return;
      }

      return context.json({ error: "invalid_request", message: "Request validation failed." }, 400);
    }
  });

  registerLiveArtifactRoutes(app, {
    getChatStorage() {
      return storage;
    }
  });

  return app;
}

function createControllerOptions(fixture: ReturnType<typeof createStorageFixture>) {
  return {
    allowedOrigins: ["null"],
    allowedToolDirectories: [fixture.workspaceDir],
    allowedToolDirectoriesSource: "default" as const,
    agentRuntime: {
      maxStepsPerRun: 8,
      maxTokensPerRun: 32_768,
      wallClockBudgetMs: 60_000,
      maxToolCallsPerRun: 16
    },
    bearerToken: "test-token",
    connectorProvider: {
      provider: "composio" as const,
      composio: {
        apiKey: "dummy-connectors-api-key",
        baseUrl: "https://backend.composio.dev",
        timeoutMs: null,
        authConfigIds: {
          github: "github",
          notion: "notion",
          google_drive: "google_drive"
        }
      }
    },
    databasePath: fixture.databasePath,
    openai: {
      apiKey: null,
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      apiUrl: null,
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    },
    openrouterApiKey: null,
    port: 42831,
    sessionWorkspaceBaseDirectory: fixture.sessionWorkspaceBaseDirectory
  };
}

function createArtifactPayload(title = "Quarterly dashboard") {
  return {
    title,
    description: "Controller test artifact",
    tiles: [{
      title: "Revenue",
      kind: "metric" as const,
      renderJson: {
        kind: "metric" as const,
        label: "Revenue",
        value: "$42"
      },
      provenanceJson: {
        sources: [{ type: "static" as const, label: "fixture" }]
      }
    }]
  };
}

async function requestJson(app: ControllerApp, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  return app.request(`http://127.0.0.1:42831${path}`, {
    ...init,
    headers
  });
}

test("live artifact refresh routes fail closed when refresh dependencies are unavailable", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let storageAccesses = 0;

  registerLiveArtifactRoutes(app, {
    getChatStorage() {
      storageAccesses += 1;
      throw new Error("refresh dependency gate should not touch storage or execute tools");
    }
  });

  const artifactRefreshResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts/art_123/refresh", {
    method: "POST"
  });
  const tileRefreshResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts/art_123/tiles/til_123/refresh", {
    method: "POST"
  });

  assert.equal(LIVE_ARTIFACT_REFRESH_PHASE_GATE.enabled, true);
  assert.equal(artifactRefreshResponse.status, 501);
  assert.equal(tileRefreshResponse.status, 501);
  assert.equal(storageAccesses, 0);

  assert.deepEqual(await artifactRefreshResponse.json(), {
    error: LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
    message: LIVE_ARTIFACT_REFRESH_PHASE_GATE.message,
    disabled: true
  });
  assert.deepEqual(await tileRefreshResponse.json(), {
    error: LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
    message: LIVE_ARTIFACT_REFRESH_PHASE_GATE.message,
    disabled: true
  });
});

test("live artifact migrations create schema, constraints, indexes, and migration journal entries", () => {
  const fixture = createStorageFixture();

  try {
    createStorage(fixture.databasePath);

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const tables = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'live_artifact%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const indexes = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_live_artifact%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const latestMigration = connection
        .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE created_at = ?")
        .get(1760000008000) as { count: number };

      assert.deepEqual(tables.map((row) => row.name), [
        "live_artifact_refresh_steps",
        "live_artifact_refreshes",
        "live_artifact_tiles",
        "live_artifacts"
      ]);
      assert.ok(indexes.some((row) => row.name === "idx_live_artifacts_pinned_updated_at"));
      assert.ok(indexes.some((row) => row.name === "idx_live_artifact_tiles_artifact_position"));
      assert.ok(indexes.some((row) => row.name === "idx_live_artifact_refresh_steps_status"));
      assert.equal(latestMigration.count, 1);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("live artifact CRUD routes validate input, hide archived artifacts by default, and order pinned first", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const app = createRouteApp(storage);

    const invalidResponse = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify({ ...createArtifactPayload("Invalid"), title: "" })
    });
    assert.equal(invalidResponse.status, 400);

    const alphaResponse = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify(createArtifactPayload("Alpha artifact"))
    });
    const betaResponse = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify(createArtifactPayload("Beta artifact"))
    });
    assert.equal(alphaResponse.status, 201);
    assert.equal(betaResponse.status, 201);
    const alpha = (await alphaResponse.json() as { artifact: { id: string; title: string; pinned: boolean } }).artifact;
    const beta = (await betaResponse.json() as { artifact: { id: string; title: string; pinned: boolean } }).artifact;

    const detailResponse = await requestJson(app, `/api/live-artifacts/${alpha.id}`);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json() as { artifact: { title: string; tiles: unknown[] } }).artifact.tiles.length, 1);

    const updateResponse = await requestJson(app, `/api/live-artifacts/${alpha.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Alpha renamed", description: null })
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json() as { artifact: { title: string; description: string | null } }).artifact.title, "Alpha renamed");

    const pinResponse = await requestJson(app, `/api/live-artifacts/${alpha.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: true })
    });
    assert.equal(pinResponse.status, 200);
    assert.equal((await pinResponse.json() as { artifact: { pinned: boolean } }).artifact.pinned, true);

    const archiveResponse = await requestJson(app, `/api/live-artifacts/${beta.id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true })
    });
    assert.equal(archiveResponse.status, 200);

    const defaultListResponse = await requestJson(app, "/api/live-artifacts");
    assert.equal(defaultListResponse.status, 200);
    const defaultList = await defaultListResponse.json() as { artifacts: Array<{ id: string; pinned: boolean; status: string }> };
    assert.deepEqual(defaultList.artifacts.map((artifact) => artifact.id), [alpha.id]);
    assert.equal(defaultList.artifacts[0]?.pinned, true);

    const includeArchivedResponse = await requestJson(app, "/api/live-artifacts?includeArchived=true");
    assert.equal(includeArchivedResponse.status, 200);
    const includeArchived = await includeArchivedResponse.json() as { artifacts: Array<{ id: string; status: string }> };
    assert.equal(includeArchived.artifacts[0]?.id, alpha.id);
    assert.ok(includeArchived.artifacts.some((artifact) => artifact.id === beta.id && artifact.status === "archived"));

    const badQueryResponse = await requestJson(app, "/api/live-artifacts?limit=not-a-number");
    assert.equal(badQueryResponse.status, 400);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact storage rolls back failed creates and preserves existing tiles on failed replacement", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const connection = new DatabaseSync(fixture.databasePath);

    try {
      assert.throws(() => storage.createLiveArtifact({ ...createArtifactPayload("Missing session"), sessionId: "ses_missing" }));
      const artifactCount = connection.prepare("SELECT COUNT(*) AS count FROM live_artifacts").get() as { count: number };
      assert.equal(artifactCount.count, 0);

      const artifact = storage.createLiveArtifact(createArtifactPayload("Stable tiles"));
      assert.equal(artifact.tiles.length, 1);

      assert.throws(() => storage.replaceLiveArtifactTiles({
        artifactId: artifact.id,
        tiles: [{
          title: "Unsafe replacement",
          kind: "link_card",
          renderJson: {
            kind: "link_card",
            title: "Unsafe",
            url: "javascript:alert(1)"
          }
        }]
      }));

      const afterFailure = storage.getLiveArtifact(artifact.id);
      assert.equal(afterFailure.tiles.length, 1);
      assert.equal(afterFailure.tiles[0]?.title, "Revenue");
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("live artifact database constraints and foreign-key behavior are enforced", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const session = storage.createSession({ title: "Artifact session" });
    const artifact = storage.createLiveArtifact({ ...createArtifactPayload("Session artifact"), sessionId: session.id });
    const tileId = artifact.tiles[0]?.id;
    assert.ok(tileId);

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      assert.throws(() => {
        connection
          .prepare(
            `INSERT INTO live_artifacts (id, schema_version, title, slug, status, pinned, refresh_status, created_at, updated_at)
             VALUES ('art_bad_status', 1, 'Bad', 'bad', 'deleted', 0, 'idle', ?, ?)`
          )
          .run(new Date().toISOString(), new Date().toISOString());
      });
      assert.throws(() => {
        connection
          .prepare(
            `INSERT INTO live_artifact_tiles (id, artifact_id, schema_version, position, title, kind, render_json, created_at, updated_at)
             VALUES ('til_bad_json', ?, 1, 9, 'Bad JSON', 'json', 'not-json', ?, ?)`
          )
          .run(artifact.id, new Date().toISOString(), new Date().toISOString());
      });

      storage.deleteSession(session.id);
      assert.equal(storage.getLiveArtifact(artifact.id).sessionId, null);

      connection.prepare("DELETE FROM live_artifacts WHERE id = ?").run(artifact.id);
      const tileCount = connection.prepare("SELECT COUNT(*) AS count FROM live_artifact_tiles WHERE id = ?").get(tileId) as { count: number };
      assert.equal(tileCount.count, 0);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("live artifact routes reject unsafe oversized render JSON", async () => {
  const fixture = createStorageFixture();

  try {
    const app = createRouteApp(createStorage(fixture.databasePath));
    const response = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify({
        title: "Oversized render",
        tiles: [{
          title: "Huge markdown",
          kind: "markdown",
          renderJson: {
            kind: "markdown",
            markdown: "x".repeat(20_001)
          }
        }]
      })
    });

    assert.equal(response.status, 400);
  } finally {
    fixture.cleanup();
  }
});

test("controller app requires local API auth for live artifact routes", async () => {
  const fixture = createStorageFixture();

  try {
    const { app } = createControllerApp(createControllerOptions(fixture));

    const unauthenticatedResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts", {
      headers: {
        Host: "127.0.0.1:42831"
      }
    });
    assert.equal(unauthenticatedResponse.status, 401);

    const authenticatedResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts", {
      headers: {
        Authorization: "Bearer test-token",
        Host: "127.0.0.1:42831"
      }
    });
    assert.equal(authenticatedResponse.status, 200);
  } finally {
    fixture.cleanup();
  }
});
