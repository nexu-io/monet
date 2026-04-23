import { OpenAPIHono } from "@hono/zod-openapi";

import { createChatStorage, type ChatStorage } from "./chat-storage";
import { createLocalAuthMiddleware } from "./middleware/local-auth";
import { registerChatRoutes } from "./routes/chat";
import { registerHealthRoutes } from "./routes/health";
import { registerSessionRoutes } from "./routes/sessions";

export interface CreateControllerAppOptions {
  readonly bearerToken: string;
  readonly databasePath: string;
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
  let chatStorage: ChatStorage | undefined;

  function getChatStorage() {
    chatStorage ??= createChatStorage({ databasePath: options.databasePath });

    return chatStorage;
  }

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
      },
      {
        name: "Sessions",
        description: "Session lifecycle and history endpoints."
      }
    ]
  });

  registerHealthRoutes(app);
  registerChatRoutes(app, { getChatStorage });
  registerSessionRoutes(app, { getChatStorage });

  return app;
}
