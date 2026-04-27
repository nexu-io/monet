import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import { createToolRegistry } from "../tools/registry";
import { refreshLiveArtifact } from "./refresh";

function createStorageFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-live-artifact-refresh-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");

  mkdirSync(workspaceDir, { recursive: true });

  return {
    databasePath,
    fixtureDir,
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

test("live artifact refresh preserves previous tile render JSON on partial failure and returns failures", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      title: "Refreshable report",
      description: null,
      tiles: [
        {
          title: "Successful metric",
          kind: "metric",
          renderJson: {
            kind: "metric",
            label: "Successful metric",
            value: "1"
          },
          sourceJson: {
            type: "tool",
            toolName: "get_metric",
            input: { accountId: "acct_123" },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "metric" }
          }
        },
        {
          title: "Failing metric",
          kind: "metric",
          renderJson: {
            kind: "metric",
            label: "Failing metric",
            value: "previous"
          },
          sourceJson: {
            type: "tool",
            toolName: "get_failing_metric",
            input: { accountId: "acct_123" },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "metric" }
          }
        }
      ]
    });

    const successfulTileId = artifact.tiles[0]!.id;
    const failingTileId = artifact.tiles[1]!.id;
    const registry = createToolRegistry([
      {
        metadata: {
          name: "get_metric",
          description: "Return a metric",
          requiresConfirmation: false
        },
        inputSchema: {},
        execute() {
          return { value: "42" };
        }
      },
      {
        metadata: {
          name: "get_failing_metric",
          description: "Fail a metric refresh",
          requiresConfirmation: false
        },
        inputSchema: {},
        execute() {
          throw new Error("provider temporarily unavailable");
        }
      }
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.deepEqual(result.failures, [{
      tileId: failingTileId,
      tileTitle: "Failing metric",
      toolName: "get_failing_metric",
      error: "provider temporarily unavailable"
    }]);

    const successfulTile = result.artifact.tiles.find((tile) => tile.id === successfulTileId);
    const failingTile = result.artifact.tiles.find((tile) => tile.id === failingTileId);

    assert.ok(successfulTile);
    assert.equal(successfulTile.renderJson.kind, "metric");
    assert.equal(successfulTile.renderJson.value, "42");
    assert.equal(successfulTile.lastError, null);

    assert.ok(failingTile);
    assert.deepEqual(failingTile.renderJson, {
      kind: "metric",
      label: "Failing metric",
      value: "previous"
    });
    assert.equal(failingTile.refreshStatus, "failed");
    assert.equal(failingTile.lastError, "provider temporarily unavailable");
    assert.equal(result.artifact.refreshStatus, "failed");
    assert.equal(result.artifact.lastRefreshError, "1 tile failed to refresh.");

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const refresh = connection
        .prepare("SELECT status, error_message FROM live_artifact_refreshes WHERE artifact_id = ? ORDER BY started_at DESC LIMIT 1")
        .get(artifact.id) as { status: string; error_message: string | null };
      const steps = connection
        .prepare("SELECT tile_id, status, error_message FROM live_artifact_refresh_steps ORDER BY started_at ASC")
        .all() as Array<{ tile_id: string; status: string; error_message: string | null }>;

      assert.equal(refresh.status, "partial_failed");
      assert.equal(refresh.error_message, "1 tile failed to refresh.");
      assert.deepEqual(steps.map((step) => ({ tileId: step.tile_id, status: step.status, error: step.error_message })), [
        { tileId: successfulTileId, status: "completed", error: null },
        { tileId: failingTileId, status: "failed", error: "provider temporarily unavailable" }
      ]);
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});
