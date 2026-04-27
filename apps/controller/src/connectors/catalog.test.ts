import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTOR_TOOL_APPROVAL_DEFAULTS,
  CONNECTOR_V1_TOOL_POLICIES,
  createConnectorToolPolicy,
  requiresConnectorToolApproval
} from "./catalog";

test("connector tool approval defaults cover all v1 side effects", () => {
  assert.deepEqual(CONNECTOR_TOOL_APPROVAL_DEFAULTS, {
    read: "first_use",
    write: "always",
    destructive: "always",
    external_send: "always"
  });

  assert.deepEqual(CONNECTOR_V1_TOOL_POLICIES, {
    read: { sideEffect: "read", approval: "first_use" },
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
  assert.equal(requiresConnectorToolApproval({ sideEffect: "read", approval: "first_use" }), true);
  assert.equal(requiresConnectorToolApproval({ sideEffect: "write", approval: "always" }), true);
});
