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

test("live artifact refresh validates connector source metadata before execution", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      title: "Connector report",
      description: null,
      tiles: [
        {
          title: "Open issues",
          kind: "markdown",
          renderJson: { kind: "markdown", markdown: "previous" },
          sourceJson: {
            type: "connector_tool",
            toolName: "github_search_issues",
            input: { query: "repo:acme/widgets is:open" },
            connector: {
              connectorId: "github",
              connectorName: "GitHub",
              accountLabel: "octocat",
              providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
            },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "markdown" }
          }
        }
      ]
    });

    let executions = 0;
    const registry = createToolRegistry([
      {
        metadata: {
          name: "github_search_issues",
          description: "Search issues",
          requiresConfirmation: false,
          connector: {
            connectorId: "github",
            connectorName: "GitHub",
            accountLabel: "octocat",
            connectionState: "connected",
            connected: true,
            toolName: "Search issues and pull requests",
            providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
            approvalPolicy: { sideEffect: "read", approval: "never" }
          }
        },
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false
        },
        execute() {
          executions += 1;
          return { kind: "markdown", markdown: "fresh issues" };
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

    assert.equal(executions, 1);
    assert.deepEqual(result.failures, []);
    assert.equal(result.artifact.tiles[0]!.lastError, null);
    assert.deepEqual(result.artifact.tiles[0]!.renderJson, { kind: "markdown", markdown: "fresh issues" });

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const step = connection
        .prepare("SELECT connector_id, connector_account_label, connector_provider_tool_id, approval_basis FROM live_artifact_refresh_steps LIMIT 1")
        .get() as {
          connector_id: string;
          connector_account_label: string;
          connector_provider_tool_id: string;
          approval_basis: string;
        };

      assert.equal(step.connector_id, "github");
      assert.equal(step.connector_account_label, "octocat");
      assert.equal(step.connector_provider_tool_id, "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS");
      assert.equal(step.approval_basis, "manual_refresh_granted_for_read_only");
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh fails closed for stale connector metadata and current schema mismatch", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      title: "Connector report",
      description: null,
      tiles: [
        {
          title: "Stale tool",
          kind: "json",
          renderJson: { kind: "json", value: { previous: true } },
          sourceJson: {
            type: "connector_tool",
            toolName: "github_stale",
            input: { query: "is:open" },
            connector: {
              connectorId: "github",
              connectorName: "GitHub",
              accountLabel: "octocat",
              providerToolId: "GITHUB_OLD_TOOL"
            },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "json" }
          }
        },
        {
          title: "Schema mismatch",
          kind: "json",
          renderJson: { kind: "json", value: { previous: true } },
          sourceJson: {
            type: "connector_tool",
            toolName: "github_schema",
            input: { oldQuery: "is:open" },
            connector: {
              connectorId: "github",
              connectorName: "GitHub",
              accountLabel: "octocat",
              providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
            },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "json" }
          }
        },
        {
          title: "Expired account",
          kind: "json",
          renderJson: { kind: "json", value: { previous: true } },
          sourceJson: {
            type: "connector_tool",
            toolName: "github_expired",
            input: { query: "is:open" },
            connector: {
              connectorId: "github",
              connectorName: "GitHub",
              accountLabel: "octocat",
              providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
            },
            refreshPermission: "manual_refresh_granted_for_read_only",
            outputMapping: { preferredKind: "json" }
          }
        }
      ]
    });

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_stale", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_schema", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false
        },
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_expired", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: false,
        connectionState: "expired",
        execute() {
          executions += 1;
          return { ok: true };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.equal(executions, 0);
    assert.deepEqual(result.failures.map((failure) => failure.error), [
      "Connector refresh source provider tool ID is stale: github_stale",
      "Refresh source input no longer matches current tool schema for github_schema: input.query is required by the current tool schema",
      "Connector account is not available for refresh: github_expired"
    ]);
    assert.equal(result.artifact.refreshStatus, "failed");
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh rejects unsafe, stale, and unclassified connector sources before execution", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      title: "Unsafe connector report",
      description: null,
      tiles: [
        createConnectorTile("Write-capable", "github_write"),
        createConnectorTile("Destructive", "github_delete"),
        createConnectorTile("External send", "github_send"),
        createConnectorTile("Unknown", "github_unknown"),
        createConnectorTile("Unclassified", "github_unclassified"),
        createConnectorTile("Stale account", "github_stale_account")
      ]
    });

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_write", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: { sideEffect: "write", approval: "always" },
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_delete", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: { sideEffect: "destructive", approval: "always" },
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_send", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: { sideEffect: "external_send", approval: "always" },
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_unknown", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: { sideEffect: "unknown", approval: "always" },
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_unclassified", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: null,
        execute() {
          executions += 1;
          return { ok: true };
        }
      }),
      createConnectorDefinition("github_stale_account", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        accountLabel: "renamed-account",
        execute() {
          executions += 1;
          return { ok: true };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.equal(executions, 0);
    assert.deepEqual(result.failures.map((failure) => failure.error), [
      "Connector refresh source is not currently classified as read-only: github_write",
      "Connector refresh source is not currently classified as read-only: github_delete",
      "Connector refresh source is not currently classified as read-only: github_send",
      "Connector refresh source is not currently classified as read-only: github_unknown",
      "Connector refresh source is not currently classified as read-only: github_unclassified",
      "Connector refresh source account is stale: github_stale_account"
    ]);
    assert.equal(result.artifact.refreshStatus, "failed");
  } finally {
    fixture.cleanup();
  }
});

function createConnectorTile(title: string, toolName: string) {
  return {
    title,
    kind: "json" as const,
    renderJson: { kind: "json" as const, value: { previous: true } },
    sourceJson: {
      type: "connector_tool" as const,
      toolName,
      input: { query: "is:open" },
      connector: {
        connectorId: "github",
        connectorName: "GitHub",
        accountLabel: "octocat",
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
      },
      refreshPermission: "manual_refresh_granted_for_read_only" as const,
      outputMapping: { preferredKind: "json" as const }
    }
  };
}

function createConnectorDefinition(
  name: string,
  options: {
    providerToolId: string;
    connected: boolean;
    connectionState: string;
    accountLabel?: string | null;
    approvalPolicy?: { sideEffect: string; approval: string } | null;
    inputSchema?: Record<string, unknown>;
    execute: () => unknown;
  }
) {
  return {
    metadata: {
      name,
      description: "Connector test tool",
      requiresConfirmation: false,
      connector: {
        connectorId: "github",
        connectorName: "GitHub",
        accountLabel: options.accountLabel ?? "octocat",
        connectionState: options.connectionState,
        connected: options.connected,
        toolName: "Search issues and pull requests",
        providerToolId: options.providerToolId,
        approvalPolicy: options.approvalPolicy === null
          ? (undefined as never)
          : (options.approvalPolicy ?? { sideEffect: "read", approval: "never" })
      }
    },
    inputSchema: options.inputSchema ?? {},
    execute: options.execute
  };
}
