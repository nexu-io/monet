import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import { createControllerApp, type ControllerApp, type ControllerAppVariables } from "../app";
import { createChatStorage, type ChatStorage } from "../chat-storage";
import { createToolRegistry } from "../tools/registry";
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

test("list live artifacts always returns snapshot summaries only", async () => {
  const summaryArtifact = {
    id: "art_summary_1",
    schemaVersion: 1,
    sessionId: null,
    createdByRunId: null,
    createdByToolCallId: null,
    title: "Summary artifact",
    slug: "summary-artifact",
    description: null,
    contentType: "html_page_v1",
    currentRevisionId: "rev_1",
    status: "active",
    pinned: false,
    refreshStatus: "idle",
    refreshStartedAt: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    lastRefreshedAt: null,
    lastRefreshError: null
  };
  const detailedArtifact = {
    ...summaryArtifact,
    document: {
      format: "html_template_v1",
      sanitizedHtml: "<main>Hello</main>",
      dataJson: {},
      dataSchemaJson: null,
      sourceJson: null,
      sanitizerVersion: "basic-html-v1"
    },
    tiles: []
  };
  const app = createRouteApp({
    listLiveArtifacts() {
      return [summaryArtifact];
    },
    getLiveArtifact() {
      return detailedArtifact;
    }
  } as unknown as ChatStorage);

  const defaultResponse = await requestJson(app, "/api/live-artifacts");
  assert.equal(defaultResponse.status, 200);
  assert.equal((await defaultResponse.json() as { artifacts: Array<Record<string, unknown>> }).artifacts[0]?.document, undefined);

  const includeStatesResponse = await requestJson(app, "/api/live-artifacts?includeSourceStates=true");
  assert.equal(includeStatesResponse.status, 200);
  const includeStatesBody = await includeStatesResponse.json() as { artifacts: Array<Record<string, unknown>> };
  assert.equal(includeStatesBody.artifacts[0]?.document, undefined);
  assert.equal(includeStatesBody.artifacts[0]?.sourceStates, undefined);
});

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
  return createHtmlArtifactPayload(title);
}

function createHtmlArtifactPayload(title = "HTML dashboard") {
  return {
    title,
    description: "HTML page artifact",
    contentType: "html_page_v1" as const,
    document: {
      format: "html_template_v1" as const,
      sanitizedHtml: "<main><h1>Repository status</h1><p>Rendered as a sandboxed HTML page.</p></main>",
      dataJson: {
        repositories: [{ name: "monet-connectors", openIssues: 3 }]
      },
      sanitizerVersion: "basic-html-v1"
    }
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
  assert.equal(tileRefreshResponse.status, 404);
  assert.equal(storageAccesses, 0);

  assert.deepEqual(await artifactRefreshResponse.json(), {
    error: LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
    message: LIVE_ARTIFACT_REFRESH_PHASE_GATE.message,
    disabled: true
  });
});

test("sessionless live artifact refreshes use artifact-specific workspaces", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const first = storage.createLiveArtifact(createHtmlArtifactPayload("First refreshable"));
    const second = storage.createLiveArtifact(createHtmlArtifactPayload("Second refreshable"));
    const ensuredSessionIds: string[] = [];
    const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

    registerLiveArtifactRoutes(app, {
      getChatStorage() {
        return storage;
      },
      toolRegistry: createToolRegistry([]),
      sessionWorkspaceService: {
        baseDirectory: fixture.sessionWorkspaceBaseDirectory,
        getWorkspacePath(sessionId: string) {
          return join(fixture.sessionWorkspaceBaseDirectory, sessionId, "workspace");
        },
        async ensureWorkspace(sessionId: string) {
          ensuredSessionIds.push(sessionId);
          return join(fixture.sessionWorkspaceBaseDirectory, sessionId, "workspace");
        },
        async deleteWorkspace() {},
        async cleanupOrphanWorkspaces() {
          return { scannedCount: 0, deletedCount: 0, skippedCount: 0 };
        },
        async listWorkspaceMetadata(sessionId: string) {
          return {
            sessionId,
            workspacePath: join(fixture.sessionWorkspaceBaseDirectory, sessionId, "workspace"),
            exists: false,
            fileCount: 0,
            directoryCount: 0,
            sizeBytes: 0,
            updatedAt: null
          };
        }
      }
    });

    const firstResponse = await requestJson(app, `/api/live-artifacts/${first.id}/refresh`, { method: "POST" });
    const secondResponse = await requestJson(app, `/api/live-artifacts/${second.id}/refresh`, { method: "POST" });

    assert.equal(firstResponse.status, 500);
    assert.equal(secondResponse.status, 500);
    assert.equal(ensuredSessionIds.length, 2);
    assert.notEqual(ensuredSessionIds[0], ensuredSessionIds[1]);
    assert.match(ensuredSessionIds[0] ?? "", /^ses_liveartifactrefresh[a-f0-9]{24}$/);
    assert.match(ensuredSessionIds[1] ?? "", /^ses_liveartifactrefresh[a-f0-9]{24}$/);
    assert.ok(!ensuredSessionIds.includes("ses_liveartifactrefresh"));
  } finally {
    fixture.cleanup();
  }
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
        .get(1760000009000) as { count: number };

      assert.deepEqual(tables.map((row) => row.name), [
        "live_artifact_documents",
        "live_artifact_refresh_steps",
        "live_artifact_refreshes",
        "live_artifact_tiles",
        "live_artifacts"
      ]);
      assert.ok(indexes.some((row) => row.name === "idx_live_artifacts_pinned_updated_at"));
      assert.ok(indexes.some((row) => row.name === "idx_live_artifact_tiles_artifact_position"));
      assert.ok(indexes.some((row) => row.name === "idx_live_artifact_documents_artifact_created_at"));
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

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const now = new Date().toISOString();
      connection.exec("PRAGMA ignore_check_constraints = ON");
      connection
        .prepare(
          `INSERT INTO live_artifacts (
             id, schema_version, title, slug, description, content_type, current_revision_id, status, pinned, refresh_status,
             created_at, updated_at
           ) VALUES ('art_legacy_tiles', 1, 'Legacy tiles', 'legacy-tiles', NULL, 'tiles_v1', NULL, 'active', 0, 'idle', ?, ?)`
        )
        .run(now, now);
      connection.exec("PRAGMA ignore_check_constraints = OFF");
    } finally {
      connection.exec("PRAGMA ignore_check_constraints = OFF");
      connection.close();
    }

    const detailResponse = await requestJson(app, `/api/live-artifacts/${alpha.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { artifact: { title: string; document: unknown; sourceStates?: unknown; tiles: Array<{ sourceState?: unknown }> } };
    assert.equal(detail.artifact.document !== null, true);
    assert.equal(detail.artifact.sourceStates, undefined);
    assert.equal(detail.artifact.tiles.every((tile) => tile.sourceState === undefined), true);

    const updateResponse = await requestJson(app, `/api/live-artifacts/${alpha.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Alpha renamed", description: null })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      artifact: { title: string; description: string | null; sourceStates?: unknown; tiles: Array<{ sourceState?: unknown }> };
    };
    assert.equal(updated.artifact.title, "Alpha renamed");
    assert.equal(updated.artifact.sourceStates, undefined);
    assert.equal(updated.artifact.tiles.every((tile) => tile.sourceState === undefined), true);

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
    const defaultList = await defaultListResponse.json() as { artifacts: Array<{ id: string; pinned: boolean; status: string; document?: unknown }> };
    assert.deepEqual(defaultList.artifacts.map((artifact) => artifact.id), [alpha.id]);
    assert.equal(defaultList.artifacts.some((artifact) => artifact.id === "art_legacy_tiles"), false);
    assert.equal(defaultList.artifacts[0]?.pinned, true);
    assert.equal(defaultList.artifacts[0]?.document, undefined);

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

test("live artifact routes create and return sandboxable HTML page documents", async () => {
  const fixture = createStorageFixture();

  try {
    const app = createRouteApp(createStorage(fixture.databasePath));
    const createResponse = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify(createHtmlArtifactPayload("HTML status page"))
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as {
      artifact: {
        id: string;
        contentType: string;
        currentRevisionId: string | null;
        tiles: unknown[];
        document: { sanitizedHtml: string; dataJson: { repositories: Array<{ name: string }> } } | null;
      };
    };

    assert.equal(created.artifact.contentType, "html_page_v1");
    assert.ok(created.artifact.currentRevisionId);
    assert.equal(created.artifact.tiles.length, 0);
    assert.equal(created.artifact.document?.sanitizedHtml.includes("<main>"), true);
    assert.equal(created.artifact.document?.dataJson.repositories[0]?.name, "monet-connectors");

    const detailResponse = await requestJson(app, `/api/live-artifacts/${created.artifact.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as typeof created;
    assert.equal(detail.artifact.document?.sanitizedHtml, created.artifact.document?.sanitizedHtml);

    const unsafeResponse = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify({
        ...createHtmlArtifactPayload("Unsafe HTML"),
        document: {
          ...createHtmlArtifactPayload("Unsafe HTML").document,
          sanitizedHtml: "<main onclick=alert(1)>Unsafe</main><script>alert(1)</script>"
        }
      })
    });
    assert.equal(unsafeResponse.status, 201);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact storage accepts creation metadata outside public tool schema", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload("Metadata artifact"),
      createdByRunId: null,
      createdByToolCallId: null
    });

    assert.equal(artifact.createdByRunId, null);
    assert.equal(artifact.createdByToolCallId, null);
    assert.equal(artifact.contentType, "html_page_v1");
    assert.ok(artifact.document);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact storage rolls back failed creates and preserves documents on failed legacy replacement", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const connection = new DatabaseSync(fixture.databasePath);

    try {
      assert.throws(() => storage.createLiveArtifact({ ...createHtmlArtifactPayload("Missing session"), sessionId: "ses_missing" }));
      const artifactCount = connection.prepare("SELECT COUNT(*) AS count FROM live_artifacts").get() as { count: number };
      assert.equal(artifactCount.count, 0);

      const artifact = storage.createLiveArtifact(createHtmlArtifactPayload("Stable document"));
      assert.equal(artifact.tiles.length, 0);
      assert.ok(artifact.document?.sanitizedHtml);

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
      assert.equal(afterFailure.tiles.length, 0);
      assert.equal(afterFailure.document?.sanitizedHtml, artifact.document?.sanitizedHtml);
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
    const artifact = storage.createLiveArtifact({ ...createHtmlArtifactPayload("Session artifact"), sessionId: session.id });
    const tileId = "til_constraint_test";

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

      connection
        .prepare(
          `INSERT INTO live_artifact_tiles (id, artifact_id, schema_version, position, title, kind, render_json, created_at, updated_at)
           VALUES (?, ?, 1, 0, 'Legacy tile', 'markdown', ?, ?, ?)`
        )
        .run(
          tileId,
          artifact.id,
          JSON.stringify({ kind: "markdown", markdown: "Legacy tile" }),
          new Date().toISOString(),
          new Date().toISOString()
        );

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

test("live artifact routes reject legacy tile payloads", async () => {
  const fixture = createStorageFixture();

  try {
    const app = createRouteApp(createStorage(fixture.databasePath));
    const response = await requestJson(app, "/api/live-artifacts", {
      method: "POST",
      body: JSON.stringify({
        title: "Legacy tiles",
        tiles: [{
          title: "Markdown",
          kind: "markdown",
          renderJson: {
            kind: "markdown",
            markdown: "Legacy tile content"
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
