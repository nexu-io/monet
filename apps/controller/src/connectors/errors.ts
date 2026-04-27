export const CONNECTOR_PROVIDER_ERROR_CODES = [
  "connection_missing",
  "connection_expired",
  "rate_limited",
  "upstream_unavailable",
  "invalid_arguments",
  "forbidden",
  "tool_not_found",
  "provider_error"
] as const;

export type ConnectorProviderErrorCode = (typeof CONNECTOR_PROVIDER_ERROR_CODES)[number];

export interface NormalizedConnectorProviderError {
  readonly code: ConnectorProviderErrorCode;
  readonly message: string;
  readonly statusCode: number;
}

export const CONNECTOR_PROVIDER_ERROR_STATUS_CODES: Record<ConnectorProviderErrorCode, number> = {
  connection_missing: 409,
  connection_expired: 401,
  rate_limited: 429,
  upstream_unavailable: 503,
  invalid_arguments: 400,
  forbidden: 403,
  tool_not_found: 404,
  provider_error: 502
};

const CONNECTOR_PROVIDER_ERROR_MESSAGES: Record<ConnectorProviderErrorCode, string> = {
  connection_missing: "Connector account is not connected.",
  connection_expired: "Connector account credentials have expired. Reconnect to continue.",
  rate_limited: "Connector provider rate limit exceeded. Try again later.",
  upstream_unavailable: "Connector provider is temporarily unavailable. Try again later.",
  invalid_arguments: "Connector tool arguments are invalid.",
  forbidden: "Connector provider denied access to this resource.",
  tool_not_found: "Connector tool was not found or is not available.",
  provider_error: "Connector provider request failed."
};

export class ConnectorProviderError extends Error implements NormalizedConnectorProviderError {
  readonly code: ConnectorProviderErrorCode;
  readonly statusCode: number;

  constructor(options: { code: ConnectorProviderErrorCode; message?: string; statusCode?: number; cause?: unknown }) {
    super(options.message ?? CONNECTOR_PROVIDER_ERROR_MESSAGES[options.code], { cause: options.cause });
    this.name = "ConnectorProviderError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? CONNECTOR_PROVIDER_ERROR_STATUS_CODES[options.code];
  }
}

export function isConnectorProviderErrorCode(value: unknown): value is ConnectorProviderErrorCode {
  return typeof value === "string" && (CONNECTOR_PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

export function getConnectorProviderErrorMessage(code: ConnectorProviderErrorCode): string {
  return CONNECTOR_PROVIDER_ERROR_MESSAGES[code];
}

export function createConnectorProviderError(
  code: ConnectorProviderErrorCode,
  options?: { message?: string; statusCode?: number; cause?: unknown }
): ConnectorProviderError {
  return new ConnectorProviderError({ code, ...options });
}

export function normalizeConnectorProviderError(
  error: unknown,
  options?: { fallbackCode?: ConnectorProviderErrorCode; message?: string }
): ConnectorProviderError {
  if (error instanceof ConnectorProviderError) {
    return error;
  }

  const providerCode = getProviderErrorCode(error);
  const statusCode = getProviderStatusCode(error);
  const code = providerCode ?? mapStatusCodeToConnectorProviderErrorCode(statusCode) ?? options?.fallbackCode ?? "provider_error";

  return createConnectorProviderError(code, {
    ...(options?.message ? { message: options.message } : {}),
    statusCode: statusCode ?? CONNECTOR_PROVIDER_ERROR_STATUS_CODES[code],
    cause: error
  });
}

function getProviderErrorCode(error: unknown): ConnectorProviderErrorCode | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = "code" in error ? (error as { readonly code?: unknown }).code : undefined;
  return isConnectorProviderErrorCode(candidate) ? candidate : undefined;
}

function getProviderStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidates = [
    "statusCode" in error ? (error as { readonly statusCode?: unknown }).statusCode : undefined,
    "status" in error ? (error as { readonly status?: unknown }).status : undefined
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }

  return undefined;
}

function mapStatusCodeToConnectorProviderErrorCode(statusCode: number | undefined): ConnectorProviderErrorCode | undefined {
  if (statusCode === undefined) {
    return undefined;
  }

  if (statusCode === 400 || statusCode === 422) {
    return "invalid_arguments";
  }

  if (statusCode === 401) {
    return "connection_expired";
  }

  if (statusCode === 403) {
    return "forbidden";
  }

  if (statusCode === 404) {
    return "tool_not_found";
  }

  if (statusCode === 429) {
    return "rate_limited";
  }

  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return "upstream_unavailable";
  }

  return undefined;
}
