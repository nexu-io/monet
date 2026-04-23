import type { Context, MiddlewareHandler, Next } from "hono";

import { createLogger } from "../logger";
import { createErrorResponse } from "../openapi";
import { getRequestId } from "../request-context";

const authLogger = createLogger("controller", {
  component: "local-auth"
});

export interface LocalAuthOptions {
  readonly allowedOrigins: readonly string[];
  readonly bearerToken: string;
  readonly port: number;
}

export function createLocalAuthMiddleware(options: LocalAuthOptions): MiddlewareHandler {
  return async function localAuthMiddleware(context: Context, next: Next) {
    if (!hasAllowedHost(context.req.header("host"), options.port)) {
      authLogger.warn("auth.invalid_host", buildAuthLogContext(context));

      return context.json(
        createErrorResponse("invalid_host", "Host header must target 127.0.0.1 or localhost on the configured controller port."),
        403
      );
    }

    if (isCorsPreflight(context)) {
      authLogger.warn("auth.cors_preflight_rejected", buildAuthLogContext(context));

      return context.json(
        createErrorResponse("cors_not_supported", "CORS preflight requests are not supported by the local controller."),
        403
      );
    }

    const origin = context.req.header("origin");

    if (origin && !isAllowedOrigin(origin, options.allowedOrigins)) {
      authLogger.warn("auth.invalid_origin", buildAuthLogContext(context, { origin }));

      return context.json(createErrorResponse("invalid_origin", "Origin is not allowed to access the local controller."), 403);
    }

    if (context.req.header("cookie")) {
      authLogger.warn("auth.cookie_auth_rejected", buildAuthLogContext(context));

      return context.json(
        createErrorResponse("cookie_auth_not_supported", "Cookie-based authentication is not supported by the local controller."),
        400
      );
    }

    const header = context.req.header("authorization");
    const token = extractBearerToken(header);

    if (token !== options.bearerToken) {
      authLogger.warn("auth.unauthorized", buildAuthLogContext(context, { hasAuthorizationHeader: header != null }));

      return context.json(createErrorResponse("unauthorized", "Missing or invalid bearer token."), 401);
    }

    await next();
  };
}

function buildAuthLogContext(context: Context, extra: Record<string, unknown> = {}) {
  return {
    requestId: getRequestId(context),
    method: context.req.method,
    path: context.req.path,
    host: context.req.header("host"),
    ...extra
  };
}

function hasAllowedHost(header: string | undefined, port: number): boolean {
  if (!header) {
    return false;
  }

  const host = stripPort(header.trim().toLowerCase());
  const requestPort = extractPort(header);

  return requestPort === port && (host === "127.0.0.1" || host === "localhost");
}

function isAllowedOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  if (origin === "null") {
    return allowedOrigins.includes("null");
  }

  try {
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

function isCorsPreflight(context: Context): boolean {
  return context.req.method === "OPTIONS" && context.req.header("access-control-request-method") != null;
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

function extractPort(host: string): number | null {
  const match = host.trim().match(/:(\d+)$/);
  const port = match?.[1];

  if (!port) {
    return null;
  }

  return Number.parseInt(port, 10);
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
