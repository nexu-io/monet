import { OpenAPIHono } from "@hono/zod-openapi";

import { createChatStorage } from "./chat-storage";
import { createLocalAuthMiddleware } from "./middleware/local-auth";
import { registerChatRoutes } from "./routes/chat";
import { registerHealthRoutes } from "./routes/health";
import { registerProviderRoutes } from "./routes/providers";
import { registerSessionRoutes } from "./routes/sessions";

export interface CreateControllerAppOptions {
  readonly allowedOrigins: readonly string[];
  readonly bearerToken: string;
  readonly databasePath: string;
  readonly port: number;
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
  const chatStorage = createChatStorage({ databasePath: options.databasePath });

  function getChatStorage() {
    return chatStorage;
  }

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: options.allowedOrigins,
      bearerToken: options.bearerToken,
      port: options.port
    })
  );

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
      },
      {
        name: "Sessions",
        description: "Session lifecycle and history endpoints."
      },
      {
        name: "Providers",
        description: "Provider, model catalog, and validation endpoints."
      }
    ]
  });

  registerHealthRoutes(app);
  registerChatRoutes(app, { getChatStorage });
  registerSessionRoutes(app, { getChatStorage });
  registerProviderRoutes(app, { getChatStorage });

  return app;
}
