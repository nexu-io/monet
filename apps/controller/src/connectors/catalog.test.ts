import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTOR_CATALOG,
  CONNECTOR_TOOL_APPROVAL_DEFAULTS,
  CONNECTOR_V1_TOOL_POLICIES,
  createConnectorToolPolicy,
  getConnectorCatalogItem,
  isConnectorId,
  listConnectorCatalog,
  requiresConnectorToolApproval
} from "./catalog";

test("static connector catalog exposes the curated v1 providers and metadata", () => {
  assert.deepEqual(
    listConnectorCatalog().map((connector) => ({
      id: connector.id,
      providerConnectorId: connector.providerConnectorId,
      category: connector.category,
      icon: connector.icon,
      enabledByDefault: connector.enabledByDefault,
      minimumApprovalPolicy: connector.minimumApprovalPolicy
    })),
    [
      {
        id: "github",
        providerConnectorId: "GITHUB",
        category: "developer",
        icon: "github",
        enabledByDefault: true,
        minimumApprovalPolicy: { sideEffect: "read", approval: "never" }
      },
      {
        id: "notion",
        providerConnectorId: "NOTION",
        category: "productivity",
        icon: "notion",
        enabledByDefault: true,
        minimumApprovalPolicy: { sideEffect: "read", approval: "never" }
      },
      {
        id: "google_drive",
        providerConnectorId: "GOOGLEDRIVE",
        category: "files",
        icon: "google-drive",
        enabledByDefault: true,
        minimumApprovalPolicy: { sideEffect: "read", approval: "never" }
      }
    ]
  );

  for (const connector of CONNECTOR_CATALOG) {
    assert.ok(connector.description.length > 0);
    assert.ok(connector.featuredTools.length > 0);
    assert.ok(connector.capabilitySummaries.length > 0);
    assert.ok(connector.allowedTools.length > 0);
    assert.equal(new Set(connector.allowedTools.map((tool) => tool.providerToolId)).size, connector.allowedTools.length);

    for (const featuredTool of connector.featuredTools) {
      assert.ok(
        connector.allowedTools.some((tool) => tool.providerToolId === featuredTool),
        `${connector.id} featured tool ${featuredTool} must be allowlisted`
      );
    }

    for (const tool of connector.allowedTools) {
      assert.deepEqual(tool.policy, { sideEffect: "read", approval: "never" });
      assert.ok(tool.displayName.length > 0);
      assert.ok(tool.summary.length > 0);
    }
  }
});

test("connector catalog lookup helpers only accept known connector ids", () => {
  assert.equal(getConnectorCatalogItem("github")?.displayName, "GitHub");
  assert.equal(getConnectorCatalogItem("dropbox"), undefined);
  assert.equal(isConnectorId("google_drive"), true);
  assert.equal(isConnectorId("dropbox"), false);
});

test("connector tool approval defaults cover all v1 side effects", () => {
  assert.deepEqual(CONNECTOR_TOOL_APPROVAL_DEFAULTS, {
    read: "never",
    write: "always",
    destructive: "always",
    external_send: "always"
  });

  assert.deepEqual(CONNECTOR_V1_TOOL_POLICIES, {
    read: { sideEffect: "read", approval: "never" },
    write: { sideEffect: "write", approval: "always" },
    destructive: { sideEffect: "destructive", approval: "always" },
    external_send: { sideEffect: "external_send", approval: "always" }
  });
});

test("connector tool policies retain structured side effect and approval metadata", () => {
  assert.deepEqual(createConnectorToolPolicy("external_send"), {
    sideEffect: "external_send",
    approval: "always"
  });
});

test("connector tool approval requirement is derived from structured policy approval", () => {
  assert.equal(requiresConnectorToolApproval({ sideEffect: "read", approval: "never" }), false);
  assert.equal(requiresConnectorToolApproval({ sideEffect: "read", approval: "first_use" }), false);
  assert.equal(requiresConnectorToolApproval({ sideEffect: "write", approval: "never" }), true);
  assert.equal(requiresConnectorToolApproval({ sideEffect: "write", approval: "always" }), true);
});
