import assert from "node:assert/strict";
import test from "node:test";

import { createLiveArtifactToolDefinitions } from "./live-artifacts";
import type { LiveArtifactWithTiles } from "../live-artifacts/schema";

function getLiveArtifactTools() {
  return Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {} as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
}

const sampleArtifact: LiveArtifactWithTiles = {
  id: "art_123",
  schemaVersion: 1,
  sessionId: "ses_test",
  createdByRunId: "run_test",
  createdByToolCallId: "tcl_test",
  title: "Revenue dashboard",
  slug: "revenue-dashboard",
  description: "Daily revenue summary",
  status: "active",
  pinned: false,
  refreshStatus: "idle",
  refreshStartedAt: null,
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
  lastRefreshedAt: null,
  lastRefreshError: null,
  tiles: [{
    id: "tile_123",
    artifactId: "art_123",
    schemaVersion: 1,
    position: 0,
    title: "Revenue",
    kind: "metric",
    renderJson: {
      kind: "metric",
      label: "Revenue",
      value: "$42"
    },
    provenanceJson: {
      generatedAt: "2026-04-28T00:00:00.000Z",
      sources: [{
        type: "connector_tool",
        label: "Stripe balance",
        toolName: "stripe_get_balance",
        connector: {
          connectorId: "stripe",
          connectorName: "Stripe",
          accountLabel: "Acme Stripe",
          providerToolId: "stripe.get_balance"
        },
        querySummary: "Current balance only",
        recordCount: 1,
        refreshedAt: "2026-04-28T00:00:00.000Z"
      }]
    },
    sourceJson: null,
    refreshStatus: "idle",
    refreshStartedAt: null,
    lastRefreshedAt: null,
    lastError: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  }]
};

test("create_live_artifact requires confirmation", () => {
  const tools = getLiveArtifactTools();
  const createTool = tools.create_live_artifact;

  assert.ok(createTool);
  assert.equal(createTool.metadata.requiresConfirmation, true);
});

test("update_live_artifact stays low-friction for title or description edits", () => {
  const tools = getLiveArtifactTools();
  const updateTool = tools.update_live_artifact;

  assert.ok(updateTool);
  const needsApproval = updateTool.needsApproval;

  assert.equal(updateTool.metadata.requiresConfirmation, false);
  assert.ok(needsApproval);
  assert.equal(needsApproval({ artifactId: "art_123", title: "Updated title" }, {} as never), false);
  assert.equal(needsApproval({ artifactId: "art_123", description: "Updated description" }, {} as never), false);
});

test("update_live_artifact requires approval when tiles are provided", () => {
  const tools = getLiveArtifactTools();
  const updateTool = tools.update_live_artifact;

  assert.ok(updateTool);
  const needsApproval = updateTool.needsApproval;
  assert.ok(needsApproval);
  assert.equal(
    needsApproval({
      artifactId: "art_123",
      tiles: [{
        title: "Tile title",
        kind: "markdown",
        renderJson: {
          kind: "markdown",
          markdown: "Updated markdown"
        }
      }]
    }, {} as never),
    true
  );
});

test("create_live_artifact returns linkable artifact identifiers and concise provenance", () => {
  const tools = Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {
        createLiveArtifact(input: { readonly createdByRunId?: string | null; readonly createdByToolCallId?: string | null }) {
          assert.equal(input.createdByRunId, "run_test");
          assert.equal(input.createdByToolCallId, "tcl_test");
          return sampleArtifact;
        }
      } as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
  const createTool = tools.create_live_artifact;

  assert.ok(createTool);
  const output = createTool.execute({
    title: "Revenue dashboard",
    description: "Daily revenue summary",
    tiles: [{
      title: "Revenue",
      kind: "metric",
      renderJson: {
        kind: "metric",
        label: "Revenue",
        value: "$42"
      }
    }]
  }, {
    persistedToolCallId: "tcl_test",
    sessionId: "ses_test",
    sessionWorkspacePath: "/tmp/session",
    setConnectorExecutionMetadata() {},
    toolCallId: "call_test",
    messages: [],
    abortSignal: new AbortController().signal
  }) as Record<string, unknown>;

  assert.equal(output.artifactId, "art_123");
  assert.equal(output.artifactUrl, "/artifacts/art_123");
  assert.deepEqual(output.provenance, {
    createdByRunId: "run_test",
    createdByToolCallId: "tcl_test",
    tileCount: 1,
    sourceCount: 1,
    sources: [{
      tileId: "tile_123",
      tileTitle: "Revenue",
      type: "connector_tool",
      label: "Stripe balance",
      toolName: "stripe_get_balance",
      connector: {
        connectorId: "stripe",
        connectorName: "Stripe",
        accountLabel: "Acme Stripe",
        providerToolId: "stripe.get_balance"
      },
      querySummary: "Current balance only",
      recordCount: 1,
      refreshedAt: "2026-04-28T00:00:00.000Z"
    }]
  });
});
