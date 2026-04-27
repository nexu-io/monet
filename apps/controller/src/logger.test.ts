import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "./logger";

test("logger redacts connector OAuth secrets, API keys, raw arguments, and raw results", () => {
  const previousPretty = process.env.MONET_LOG_PRETTY;
  const previousLevel = process.env.MONET_LOG_LEVEL;
  const previousLog = console.log;
  const previousError = console.error;
  const messages: string[] = [];

  process.env.MONET_LOG_PRETTY = "0";
  process.env.MONET_LOG_LEVEL = "debug";
  console.log = (message?: unknown) => {
    messages.push(String(message));
  };
  console.error = (message?: unknown) => {
    messages.push(String(message));
  };

  try {
    const logger = createLogger("test", {
      providerApiKey: "provider-api-key-secret",
      token: "binding-token-secret"
    });
    const error = new Error(
      'OAuth failed at https://provider.example/callback?code=oauth-code-secret&access_token=access-token-secret with {"refresh_token":"refresh-token-secret"}'
    );

    logger.info("connector.safe_context", {
      connectorId: "github",
      code: "oauth-code-secret",
      accessToken: "access-token-secret",
      refresh_token: "refresh-token-secret",
      api_key: "provider-api-key-secret",
      rawArguments: { query: "private-query" },
      rawResults: { body: "private-result" },
      authorization: "Bearer bearer-token-secret",
      url: "https://provider.example/oauth?state=state-secret&code=oauth-code-secret",
      json: '{"access_token":"access-token-secret","refresh_token":"refresh-token-secret"}'
    });
    logger.error("connector.safe_error", error, {
      result: "private-result",
      output: "private-output",
      args: { query: "private-query" }
    });
  } finally {
    console.log = previousLog;
    console.error = previousError;

    if (previousPretty === undefined) {
      delete process.env.MONET_LOG_PRETTY;
    } else {
      process.env.MONET_LOG_PRETTY = previousPretty;
    }

    if (previousLevel === undefined) {
      delete process.env.MONET_LOG_LEVEL;
    } else {
      process.env.MONET_LOG_LEVEL = previousLevel;
    }
  }

  const output = messages.join("\n");

  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /oauth-code-secret/);
  assert.doesNotMatch(output, /access-token-secret/);
  assert.doesNotMatch(output, /refresh-token-secret/);
  assert.doesNotMatch(output, /provider-api-key-secret/);
  assert.doesNotMatch(output, /bearer-token-secret/);
  assert.doesNotMatch(output, /state-secret/);
  assert.doesNotMatch(output, /private-query/);
  assert.doesNotMatch(output, /private-result/);
  assert.doesNotMatch(output, /private-output/);
});
