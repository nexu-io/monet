import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import {
  ListAuthorizedDirectoriesResponseSchema,
  ReplaceAuthorizedDirectoriesRequestSchema,
  createErrorResponse,
  ErrorResponseSchema
} from "../openapi";

const listAuthorizedDirectoriesRoute = createRoute({
  method: "get",
  path: "/api/settings/authorized-directories",
  tags: ["Settings"],
  summary: "List authorized directories",
  description: "Returns the persisted allowlist of authorized directories used by filesystem tools.",
  responses: {
    200: {
      description: "Authorized directories fetched successfully.",
      content: {
        "application/json": {
          schema: ListAuthorizedDirectoriesResponseSchema
        }
      }
    }
  }
});

const replaceAuthorizedDirectoriesRoute = createRoute({
  method: "put",
  path: "/api/settings/authorized-directories",
  tags: ["Settings"],
  summary: "Replace authorized directories",
  description: "Replaces the persisted allowlist of authorized directories used by filesystem tools.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ReplaceAuthorizedDirectoriesRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Authorized directories updated successfully.",
      content: {
        "application/json": {
          schema: ListAuthorizedDirectoriesResponseSchema
        }
      }
    },
    400: {
      description: "The request body was invalid.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

export function registerSettingsRoutes(app: ControllerApp, options: { getChatStorage: () => ChatStorage }) {
  app.openapi(listAuthorizedDirectoriesRoute, (context) => {
    return context.json(
      {
        authorizedDirectories: options.getChatStorage().listAuthorizedDirectories()
      },
      200
    );
  });

  app.openapi(replaceAuthorizedDirectoriesRoute, (context) => {
    try {
      const body = context.req.valid("json");

      return context.json(
        {
          authorizedDirectories: options.getChatStorage().replaceAuthorizedDirectories(body.paths)
        },
        200
      );
    } catch (error) {
      return context.json(
        createErrorResponse(
          "invalid_request",
          error instanceof Error ? error.message : "Failed to update authorized directories."
        ),
        400
      );
    }
  });
}
