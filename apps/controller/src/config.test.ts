import assert from "node:assert/strict";
import test from "node:test";

import { createControllerConfig } from "./config";

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MONET_CONTROLLER_BEARER_TOKEN: "test-token",
    ...overrides
  };
}

test("rejects zero as a controller port", () => {
  assert.throws(
    () => createControllerConfig(createEnv({ MONET_CONTROLLER_PORT: "0" })),
    /MONET_CONTROLLER_PORT must be a valid TCP port/
  );
});
