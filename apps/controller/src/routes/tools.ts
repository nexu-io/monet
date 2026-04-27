import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import {
  ConfirmToolRequestSchema,
  ListToolsResponseSchema,
  createErrorResponse
} from "../openapi";
import type { ToolRegistry } from "../tools/registry";

const listToolsRoute = createRoute({
  method: "get",
  path: "/api/tools",
  tags: ["Tools"],
  summary: "List tools",
  description: "Returns tools available from the in-process controller tool registry.",
  responses: {
    200: {
      description: "Tools fetched successfully.",
      content: {
        "application/json": {
          schema: ListToolsResponseSchema
        }
      }
    }
  }
});

export function registerToolRoutes(
  app: ControllerApp,
  options: { toolRegistry: ToolRegistry; getChatStorage: () => ChatStorage }
) {
  app.openapi(listToolsRoute, (context) => {
    return context.json(
      {
        tools: Array.from(options.toolRegistry.listTools())
      },
      200
    );
  });

  app.post("/api/tools/confirm", async (context) => {
    let body: typeof ConfirmToolRequestSchema._type;

    try {
      body = ConfirmToolRequestSchema.parse(await context.req.json());
    } catch {
      return context.json(createErrorResponse("invalid_request", "Request validation failed."), 400);
    }

    try {
      options.getChatStorage().confirmToolCall(body);

      return context.json({ ok: true as const }, 200);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        return context.json(createErrorResponse(error.errorCode, error.message), error.statusCode as 400 | 403 | 404 | 409);
      }

      throw error;
    }
  });
}
