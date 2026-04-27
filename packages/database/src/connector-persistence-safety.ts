const REDACTED_CONNECTOR_SECRET = "[redacted]";

const SENSITIVE_CONNECTOR_KEY_PATTERN =
  /(^|[^a-z0-9])(access[_-]?token|accesstoken|refresh[_-]?token|refreshtoken|oauth[_-]?token|oauthtoken|api[_-]?key|apikey|x[_-]?api[_-]?key|xapikey|authorization|client[_-]?secret|clientsecret)([^a-z0-9]|$)/i;

const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_SECRET_PATTERN =
  /([?&](?:access_token|accessToken|refresh_token|refreshToken|oauth_token|oauthToken|api_key|apiKey|apikey|client_secret|clientSecret)=)[^&#\s]+/gi;
const JSON_SECRET_PATTERN =
  /("(?:access_token|accessToken|refresh_token|refreshToken|oauth_token|oauthToken|api_key|apiKey|apikey|x-api-key|xApiKey|authorization|client_secret|clientSecret)"\s*:\s*")[^"]+(")/gi;

export function sanitizeConnectorPersistenceValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveConnectorText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConnectorPersistenceValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_CONNECTOR_KEY_PATTERN.test(key) ? REDACTED_CONNECTOR_SECRET : sanitizeConnectorPersistenceValue(entry)
      ])
    );
  }

  return value;
}

export function sanitizeConnectorPersistenceJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return redactSensitiveConnectorText(value);
  }

  return JSON.stringify(sanitizeConnectorPersistenceValue(value));
}

export function assertConnectorPersistenceSafe(fieldName: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }

  if (
    SENSITIVE_CONNECTOR_KEY_PATTERN.test(value) ||
    BEARER_TOKEN_PATTERN.test(value) ||
    QUERY_SECRET_PATTERN.test(value) ||
    JSON_SECRET_PATTERN.test(value)
  ) {
    BEARER_TOKEN_PATTERN.lastIndex = 0;
    QUERY_SECRET_PATTERN.lastIndex = 0;
    JSON_SECRET_PATTERN.lastIndex = 0;
    throw new Error(`Refusing to persist connector field ${fieldName} because it contains credential-like data`);
  }

  BEARER_TOKEN_PATTERN.lastIndex = 0;
  QUERY_SECRET_PATTERN.lastIndex = 0;
  JSON_SECRET_PATTERN.lastIndex = 0;
}

function redactSensitiveConnectorText(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, REDACTED_CONNECTOR_SECRET)
    .replace(QUERY_SECRET_PATTERN, `$1${REDACTED_CONNECTOR_SECRET}`)
    .replace(JSON_SECRET_PATTERN, `$1${REDACTED_CONNECTOR_SECRET}$2`);
}
