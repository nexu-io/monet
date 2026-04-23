import type { Context, MiddlewareHandler, Next } from "hono";

import { createErrorResponse } from "../openapi";

export interface LocalAuthOptions {
  readonly bearerToken: string;
}

export function createLocalAuthMiddleware(options: LocalAuthOptions): MiddlewareHandler {
  return async function localAuthMiddleware(context: Context, next: Next) {
    const header = context.req.header("authorization");
    const token = extractBearerToken(header);

    if (token !== options.bearerToken) {
      return context.json(createErrorResponse("unauthorized", "Missing or invalid bearer token."), 401);
    }

    await next();
  };
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
