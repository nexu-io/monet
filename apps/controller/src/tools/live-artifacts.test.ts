import assert from "node:assert/strict";
import test from "node:test";

import { createLiveArtifactToolDefinitions } from "./live-artifacts";

function getLiveArtifactTools() {
  return Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {} as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
}

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
