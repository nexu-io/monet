import { OpenAPIHono } from "@hono/zod-openapi";

import { createLocalAuthMiddleware } from "./middleware/local-auth";
import { registerHealthRoutes } from "./routes/health";

export interface CreateControllerAppOptions {
  readonly bearerToken: string;
}

export type ControllerApp = OpenAPIHono;

export function createControllerApp(options: CreateControllerAppOptions): ControllerApp {
  const app = new OpenAPIHono({
    defaultHook(result, context) {
      if (result.success) {
        return;
      }

      return context.json(
        {
          error: "invalid_request",
          message: "Request validation failed."
        },
        400
      );
    }
  });

  app.use("/api/*", createLocalAuthMiddleware({ bearerToken: options.bearerToken }));

  app.doc("/api/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Monet Controller API",
      version: "0.1.0",
      description: "Local Hono controller API for the Monet desktop application."
    },
    tags: [
      {
        name: "System",
        description: "Health and controller metadata endpoints."
      }
    ]
  });

  registerHealthRoutes(app);

  return app;
}
