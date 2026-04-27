import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { createControllerConfig } from "./config";

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MONET_CONTROLLER_BEARER_TOKEN: "test-token",
    ...overrides
  };
}

test("allows zero as a controller port for OS-assigned binding", () => {
  const config = createControllerConfig(createEnv({ MONET_CONTROLLER_PORT: "0" }));

  assert.equal(config.port, 0);
});

test("allows both loopback web dev origins by default", () => {
  const config = createControllerConfig(createEnv());

  assert.ok(config.allowedOrigins.includes("http://127.0.0.1:42832"));
  assert.ok(config.allowedOrigins.includes("http://localhost:42832"));
});

test("uses an empty tool allowed directory list by default", () => {
  const config = createControllerConfig(createEnv());

  assert.deepEqual(config.allowedToolDirectories, []);
  assert.equal(config.allowedToolDirectoriesSource, "default");
});

test("uses explicit tool allowed directories when configured", () => {
  const config = createControllerConfig(
    createEnv({
      MONET_TOOL_ALLOWED_DIRECTORIES: "./one, ./two, ./one"
    })
  );

  assert.deepEqual(config.allowedToolDirectories, [resolve("./one"), resolve("./two")]);
  assert.equal(config.allowedToolDirectoriesSource, "env");
});

test("uses explicit session workspace base directory when configured", () => {
  const config = createControllerConfig(
    createEnv({
      MONET_SESSION_WORKSPACE_DIR: "./custom-session-workspaces",
      MONET_USER_DATA_DIR: "./user-data"
    })
  );

  assert.equal(config.sessionWorkspaceBaseDirectory, resolve("./custom-session-workspaces"));
});

test("uses user data session-workspaces directory when explicit workspace base is not configured", () => {
  const config = createControllerConfig(
    createEnv({
      MONET_USER_DATA_DIR: "./user-data"
    })
  );

  assert.equal(config.sessionWorkspaceBaseDirectory, resolve("./user-data", "session-workspaces"));
});

test("uses current working directory session-workspaces fallback by default", () => {
  const config = createControllerConfig(createEnv());

  assert.equal(config.sessionWorkspaceBaseDirectory, resolve(process.cwd(), "session-workspaces"));
});
