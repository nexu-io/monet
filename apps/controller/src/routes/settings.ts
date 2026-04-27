import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import {
  ConnectorProviderComposioSettingsRequestSchema,
  ConnectorProviderComposioSettingsSchema,
  ErrorResponseSchema,
  ListAuthorizedDirectoriesResponseSchema,
  ReplaceAuthorizedDirectoriesRequestSchema,
  createErrorResponse
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

const getConnectorProviderComposioSettingsRoute = createRoute({
  method: "get",
  path: "/api/settings/connectors/composio",
  tags: ["Settings"],
  summary: "Get Composio connector provider settings",
  description: "Returns connector provider settings with sensitive values redacted.",
  responses: {
    200: {
      description: "Connector provider settings fetched successfully.",
      content: {
        "application/json": {
          schema: ConnectorProviderComposioSettingsSchema
        }
      }
    }
  }
});

const replaceConnectorProviderComposioSettingsRoute = createRoute({
  method: "put",
  path: "/api/settings/connectors/composio",
  tags: ["Settings"],
  summary: "Replace Composio connector provider settings",
  description: "Replaces persisted Composio connector provider settings.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ConnectorProviderComposioSettingsRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Connector provider settings updated successfully.",
      content: {
        "application/json": {
          schema: ConnectorProviderComposioSettingsSchema
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

  app.openapi(getConnectorProviderComposioSettingsRoute, (context) => {
    return context.json(options.getChatStorage().getConnectorProviderComposioSettingsPublic(), 200);
  });

  app.openapi(replaceConnectorProviderComposioSettingsRoute, (context) => {
    try {
      const body = context.req.valid("json");

      const settings = options.getChatStorage().replaceConnectorProviderComposioSettings(body);

      return context.json(
        {
          key: settings.key,
          provider: "composio" as const,
          apiKeyConfigured: settings.apiKey !== null,
          baseUrl: settings.baseUrl,
          timeoutMs: settings.timeoutMs,
          authConfigIds: settings.authConfigIds,
          updatedAt: settings.updatedAt
        },
        200
      );
    } catch (error) {
      return context.json(
        createErrorResponse(
          "invalid_request",
          error instanceof Error ? error.message : "Failed to update Composio connector provider settings."
        ),
        400
      );
    }
  });
}
