import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import { listConnectorCatalog, type ConnectorId } from "../connectors/catalog";
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

  app.openapi(replaceConnectorProviderComposioSettingsRoute, async (context) => {
    const storage = options.getChatStorage();

    try {
      const body = context.req.valid("json");
      const existingSettings = storage.getConnectorProviderComposioSettings();
      const apiKey = body.apiKey === undefined ? existingSettings.apiKey : body.apiKey;
      const baseUrl = body.baseUrl ?? existingSettings.baseUrl;
      const timeoutMs = body.timeoutMs === undefined ? existingSettings.timeoutMs : body.timeoutMs;
      const discoveredAuthConfigIds =
        apiKey === null
          ? {}
          : await discoverComposioAuthConfigIds({
              apiKey,
              baseUrl,
              timeoutMs
            });
      const authConfigIds = {
        ...discoveredAuthConfigIds,
        ...(body.authConfigIds ?? {})
      };

      const settings = storage.replaceConnectorProviderComposioSettings({
        ...body,
        authConfigIds
      });

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

interface ComposioAuthConfigListResponse {
  readonly items?: unknown;
  readonly data?: unknown;
}

interface ComposioAuthConfigResponse {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly toolkit?: {
    readonly slug?: unknown;
  };
  readonly toolkit_slug?: unknown;
  readonly toolkitSlug?: unknown;
}

async function discoverComposioAuthConfigIds(input: {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
}): Promise<Partial<Record<ConnectorId, string>>> {
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/api/v3/auth_configs`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Monet/0.1 ComposioAuthConfigDiscovery",
        "x-api-key": input.apiKey
      },
      ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {})
    });

    if (!response.ok) {
      return {};
    }

    const payload = (await response.json()) as ComposioAuthConfigListResponse;
    const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : [];
    const discovered: Partial<Record<ConnectorId, string>> = {};
    const connectorByToolkitSlug = new Map<string, ConnectorId>();

    for (const connector of listConnectorCatalog()) {
      connectorByToolkitSlug.set(normalizeComposioToolkitSlug(connector.providerConnectorId), connector.id);
      connectorByToolkitSlug.set(normalizeComposioToolkitSlug(connector.id), connector.id);
    }

    connectorByToolkitSlug.set("googledrive", "google_drive");
    connectorByToolkitSlug.set("gdrive", "google_drive");
    connectorByToolkitSlug.set("drive", "google_drive");

    for (const item of items) {
      if (!isComposioAuthConfigResponse(item)) {
        continue;
      }

      const authConfigId = getString(item.id);
      const toolkitSlug = getString(item.toolkit?.slug) ?? getString(item.toolkit_slug) ?? getString(item.toolkitSlug);
      const connectorId = toolkitSlug ? connectorByToolkitSlug.get(normalizeComposioToolkitSlug(toolkitSlug)) : undefined;
      const status = getString(item.status)?.toUpperCase();

      if (!authConfigId || !connectorId || discovered[connectorId] || (status && status !== "ENABLED")) {
        continue;
      }

      discovered[connectorId] = authConfigId;
    }

    return discovered;
  } catch {
    return {};
  }
}

function isComposioAuthConfigResponse(value: unknown): value is ComposioAuthConfigResponse {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeComposioToolkitSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
