import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const REDACTED_VALUE = "[REDACTED]";
const MAX_LOG_DEPTH = 5;
const MAX_STRING_LENGTH = 8_192;
const SENSITIVE_KEY_PATTERN =
  /(^code$|authorization|bearer|cookie|password|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|oauth[-_]?code|provider[-_]?api[-_]?key|raw[-_]?(arguments?|args?|results?)|^(arguments?|args?|input|output|result)$)/i;
const INLINE_SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, `$1${REDACTED_VALUE}`],
  [/(Basic\s+)[A-Za-z0-9+/=]+/gi, `$1${REDACTED_VALUE}`],
  [/((?:access_token|refresh_token|api_key|apikey|provider_api_key|authorization_code|oauth_code|code|state)=)[^\s&#?]+/gi, `$1${REDACTED_VALUE}`],
  [/((?:access_token|refresh_token|api_key|apikey|provider_api_key|authorization_code|oauth_code|code|state)\":\s*\")[^\"]+(\")/gi, `$1${REDACTED_VALUE}$2`],
  [/((?:access_token|refresh_token|api_key|apikey|provider_api_key|authorization_code|oauth_code|code|state)'\s*:\s*')[^']+(')/gi, `$1${REDACTED_VALUE}$2`]
];
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface Logger {
  child(bindings: LogContext): Logger;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, error?: unknown, context?: LogContext): void;
}

export function createLogger(scope: string, bindings: LogContext = {}): Logger {
  const baseBindings = sanitizeValue(bindings) as LogContext;
  const minimumLevel = resolveLogLevel(process.env.MONET_LOG_LEVEL);
  const prettyPrint = shouldPrettyPrintLogs();

  function emit(level: LogLevel, event: string, context?: LogContext, error?: unknown) {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[minimumLevel]) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      event,
      ...(Object.keys(baseBindings).length > 0 ? { bindings: baseBindings } : {}),
      ...(context && Object.keys(context).length > 0 ? { context: sanitizeValue(context) } : {}),
      ...(error ? { error: serializeError(error) } : {})
    };

    const message = prettyPrint ? formatPrettyLog(entry) : JSON.stringify(entry);

    if (level === "error") {
      console.error(message);
      return;
    }

    if (level === "warn") {
      console.warn(message);
      return;
    }

    console.log(message);
  }

  return {
    child(childBindings) {
      return createLogger(scope, {
        ...baseBindings,
        ...childBindings
      });
    },
    debug(event, context) {
      emit("debug", event, context);
    },
    info(event, context) {
      emit("info", event, context);
    },
    warn(event, context) {
      emit("warn", event, context);
    },
    error(event, error, context) {
      emit("error", event, context, error);
    }
  };
}

export function createRequestId() {
  return `req_${randomUUID()}`;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return sanitizeValue({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }

  return sanitizeValue(error);
}

function sanitizeValue(value: unknown, depth = 0, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (depth >= MAX_LOG_DEPTH) {
    return "[Truncated]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, depth + 1, entryKey)])
    );
  }

  return String(value);
}

function sanitizeString(value: string) {
  const redacted = INLINE_SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);

  if (redacted.length <= MAX_STRING_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_STRING_LENGTH)}… [truncated ${redacted.length - MAX_STRING_LENGTH} chars]`;
}

function resolveLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.toLowerCase() as LogLevel;
    default:
      return process.env.NODE_ENV === "production" ? "info" : "debug";
  }
}

function shouldPrettyPrintLogs() {
  if (process.env.MONET_LOG_PRETTY === "1") {
    return true;
  }

  if (process.env.MONET_LOG_PRETTY === "0") {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

function formatPrettyLog(entry: Record<string, unknown>) {
  const parts = [`[${entry.timestamp}]`, String(entry.level).toUpperCase(), `${entry.scope}:${entry.event}`];

  if (entry.bindings) {
    parts.push(`bindings=${JSON.stringify(entry.bindings)}`);
  }

  if (entry.context) {
    parts.push(`context=${JSON.stringify(entry.context)}`);
  }

  if (entry.error) {
    parts.push(`error=${JSON.stringify(entry.error)}`);
  }

  return parts.join(" ");
}
