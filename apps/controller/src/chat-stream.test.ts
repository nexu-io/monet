import assert from "node:assert/strict";
import test from "node:test";

import { resolveCurrentRunStep } from "./chat-stream";

test("resolveCurrentRunStep adds stream steps to the persisted run step count", () => {
  assert.equal(resolveCurrentRunStep(0, 0), 1);
  assert.equal(resolveCurrentRunStep(3, 0), 4);
  assert.equal(resolveCurrentRunStep(3, 1), 5);
});

test("resolveCurrentRunStep clamps negative persisted counts", () => {
  assert.equal(resolveCurrentRunStep(-2, 0), 1);
});
