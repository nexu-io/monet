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

test("authorizes the current working directory by default", () => {
  const config = createControllerConfig(createEnv());

  assert.deepEqual(config.allowedToolDirectories, [resolve(process.cwd())]);
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

test("loads Composio connector provider config from controller environment only", () => {
  const config = createControllerConfig(
    createEnv({
      COMPOSIO_API_KEY: "ignored-upstream-key",
      MONET_COMPOSIO_API_KEY: " monet-composio-key ",
      MONET_COMPOSIO_BASE_URL: "https://api.example.test/composio/",
      MONET_COMPOSIO_TIMEOUT_MS: "2500",
      MONET_COMPOSIO_GITHUB_AUTH_CONFIG_ID: " github-auth ",
      MONET_COMPOSIO_NOTION_AUTH_CONFIG_ID: "notion-auth",
      MONET_COMPOSIO_GOOGLE_DRIVE_AUTH_CONFIG_ID: "drive-auth",
      VITE_MONET_COMPOSIO_API_KEY: "renderer-key-must-not-be-read"
    })
  );

  assert.equal(config.connectorProvider.provider, "composio");
  assert.equal(config.connectorProvider.composio.apiKey, "monet-composio-key");
  assert.equal(config.connectorProvider.composio.baseUrl, "https://api.example.test/composio");
  assert.equal(config.connectorProvider.composio.timeoutMs, 2500);
  assert.deepEqual(config.connectorProvider.composio.authConfigIds, {
    github: "github-auth",
    notion: "notion-auth",
    google_drive: "drive-auth"
  });
});

test("falls back to the standard Composio environment key and default base URL", () => {
  const config = createControllerConfig(
    createEnv({
      COMPOSIO_API_KEY: "standard-composio-key"
    })
  );

  assert.equal(config.connectorProvider.composio.apiKey, "standard-composio-key");
  assert.equal(config.connectorProvider.composio.baseUrl, "https://backend.composio.dev");
});

test("rejects unsupported connector providers", () => {
  assert.throws(
    () => createControllerConfig(createEnv({ MONET_CONNECTOR_PROVIDER: "pipedream" })),
    /MONET_CONNECTOR_PROVIDER must be composio/
  );
});
