import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTOR_PROVIDER_ERROR_CODES,
  CONNECTOR_PROVIDER_ERROR_STATUS_CODES,
  ConnectorProviderError,
  createConnectorProviderError,
  getConnectorProviderErrorMessage,
  isConnectorProviderErrorCode,
  normalizeConnectorProviderError
} from "./errors";

test("connector provider error codes and defaults are normalized", () => {
  assert.deepEqual(CONNECTOR_PROVIDER_ERROR_CODES, [
    "connection_missing",
    "connection_expired",
    "rate_limited",
    "upstream_unavailable",
    "invalid_arguments",
    "forbidden",
    "tool_not_found",
    "provider_error"
  ]);

  for (const code of CONNECTOR_PROVIDER_ERROR_CODES) {
    const error = createConnectorProviderError(code);
    assert.equal(error.name, "ConnectorProviderError");
    assert.equal(error.code, code);
    assert.equal(error.statusCode, CONNECTOR_PROVIDER_ERROR_STATUS_CODES[code]);
    assert.equal(error.message, getConnectorProviderErrorMessage(code));
    assert.equal(isConnectorProviderErrorCode(code), true);
  }

  assert.equal(isConnectorProviderErrorCode("oauth_token"), false);
});

test("connector provider error normalization preserves known errors and maps upstream status codes", () => {
  const existing = new ConnectorProviderError({ code: "forbidden", message: "Denied", statusCode: 403 });
  assert.equal(normalizeConnectorProviderError(existing), existing);

  assert.deepEqual(pickNormalizedError(normalizeConnectorProviderError({ status: 400 })), {
    code: "invalid_arguments",
    message: "Connector tool arguments are invalid.",
    statusCode: 400
  });
  assert.deepEqual(pickNormalizedError(normalizeConnectorProviderError({ statusCode: 401 })), {
    code: "connection_expired",
    message: "Connector account credentials have expired. Reconnect to continue.",
    statusCode: 401
  });
  assert.deepEqual(pickNormalizedError(normalizeConnectorProviderError({ status: 429 })), {
    code: "rate_limited",
    message: "Connector provider rate limit exceeded. Try again later.",
    statusCode: 429
  });
  assert.deepEqual(pickNormalizedError(normalizeConnectorProviderError({ statusCode: 503 })), {
    code: "upstream_unavailable",
    message: "Connector provider is temporarily unavailable. Try again later.",
    statusCode: 503
  });
  assert.deepEqual(pickNormalizedError(normalizeConnectorProviderError(new Error("boom"), { fallbackCode: "provider_error", message: "Safe message" })), {
    code: "provider_error",
    message: "Safe message",
    statusCode: 502
  });
});

function pickNormalizedError(error: ConnectorProviderError) {
  return {
    code: error.code,
    message: error.message,
    statusCode: error.statusCode
  };
}
