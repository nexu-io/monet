import { createRoute } from "@hono/zod-openapi";

import { HealthResponseSchema } from "../openapi";
import type { ControllerApp } from "../app";

const getHealthRoute = createRoute({
  method: "get",
  path: "/api/health",
  tags: ["System"],
  summary: "Report controller health",
  description: "Returns a readiness payload for local controller orchestration.",
  responses: {
    200: {
      description: "Controller is ready.",
      content: {
        "application/json": {
          schema: HealthResponseSchema
        }
      }
    }
  }
});

export function registerHealthRoutes(app: ControllerApp) {
  app.openapi(getHealthRoute, (context) => {
    return context.json({
      status: "ok",
      service: "controller",
      version: "0.1.0"
    });
  });
}
