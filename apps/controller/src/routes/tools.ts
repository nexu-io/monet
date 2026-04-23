import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ListToolsResponseSchema } from "../openapi";
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

export function registerToolRoutes(app: ControllerApp, options: { toolRegistry: ToolRegistry }) {
  app.openapi(listToolsRoute, (context) => {
    return context.json(
      {
        tools: Array.from(options.toolRegistry.listTools())
      },
      200
    );
  });
}
