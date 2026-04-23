import type { Context } from "hono";

export const requestIdKey = "requestId";

export function getRequestId(context: Context) {
  return context.get(requestIdKey) as string | undefined;
}
