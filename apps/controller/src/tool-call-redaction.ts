export const REDACTED_TOOL_CALL_SECRET = "[redacted]";

const TOOL_CALL_BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOOL_CALL_QUERY_SECRET_PATTERN =
  /([?&](?:access_token|accessToken|refresh_token|refreshToken|oauth_token|oauthToken|api_key|apiKey|apikey|client_secret|clientSecret)=)[^&#\s]+/gi;
const TOOL_CALL_JSON_SECRET_PATTERN =
  /("(?:access_token|accessToken|refresh_token|refreshToken|oauth_token|oauthToken|api_key|apiKey|apikey|x-api-key|xApiKey|authorization|client_secret|clientSecret)"\s*:\s*")[^"]+(")/gi;

export function isSensitiveToolCallKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  return [
    "accesstoken",
    "refreshtoken",
    "oauthtoken",
    "apikey",
    "xapikey",
    "authorization",
    "clientsecret"
  ].some((sensitiveName) => normalized.includes(sensitiveName));
}

export function redactSensitiveToolCallText(value: string): string {
  return value
    .replace(TOOL_CALL_BEARER_TOKEN_PATTERN, REDACTED_TOOL_CALL_SECRET)
    .replace(TOOL_CALL_QUERY_SECRET_PATTERN, `$1${REDACTED_TOOL_CALL_SECRET}`)
    .replace(TOOL_CALL_JSON_SECRET_PATTERN, `$1${REDACTED_TOOL_CALL_SECRET}$2`);
}

export function sanitizeToolCallPersistenceValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveToolCallText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolCallPersistenceValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveToolCallKey(key) ? REDACTED_TOOL_CALL_SECRET : sanitizeToolCallPersistenceValue(entry)
      ])
    );
  }

  return value;
}
