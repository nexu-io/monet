import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import { getConnectorCatalogItem } from "../connectors/catalog";
import { normalizeConnectorProviderError } from "../connectors/errors";
import { hashConnectorOAuthState } from "../connectors/oauth-state";
import type { ConnectorService } from "../connectors/service";
import {
  createErrorResponse,
  DisconnectConnectorConnectionResponseSchema,
  ErrorResponseSchema,
  GetConnectorResponseSchema,
  ListConnectorsResponseSchema,
  StartConnectorConnectionRequestSchema,
  StartConnectorConnectionResponseSchema
} from "../openapi";

type ConnectorRouteErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503;

const CONNECTOR_OAUTH_PROVIDER = "composio";

const connectorIdParamSchema = z.object({
  connectorId: z.string().min(1).openapi({ param: { name: "connectorId", in: "path" }, example: "github" })
});

const listConnectorsRoute = createRoute({
  method: "get",
  path: "/api/connectors",
  tags: ["Connectors"],
  summary: "List connectors",
  description: "Returns static connector catalog cards merged with connection status for this Monet install.",
  responses: {
    200: {
      description: "Connectors fetched successfully.",
      content: {
        "application/json": {
          schema: ListConnectorsResponseSchema
        }
      }
    }
  }
});

const getConnectorRoute = createRoute({
  method: "get",
  path: "/api/connectors/{connectorId}",
  tags: ["Connectors"],
  summary: "Get connector detail",
  description: "Returns connector detail, connection status, allowlisted tools, and approval policies for this Monet install.",
  request: {
    params: connectorIdParamSchema
  },
  responses: {
    200: {
      description: "Connector fetched successfully.",
      content: {
        "application/json": {
          schema: GetConnectorResponseSchema
        }
      }
    },
    400: {
      description: "Invalid connector request.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    401: {
      description: "Connector credentials have expired.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    403: {
      description: "Connector provider denied access.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: "Connector not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "Connector connection is required.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    429: {
      description: "Connector provider rate limit exceeded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    502: {
      description: "Connector provider request failed.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    503: {
      description: "Connector provider is unavailable.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const startConnectorConnectionRoute = createRoute({
  method: "post",
  path: "/api/connectors/{connectorId}/connect",
  tags: ["Connectors"],
  summary: "Start connector connection flow",
  description: "Starts the provider OAuth flow using a cryptographically random single-use state bound to this Monet install.",
  request: {
    params: connectorIdParamSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartConnectorConnectionRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Connector connection flow started successfully.",
      content: {
        "application/json": {
          schema: StartConnectorConnectionResponseSchema
        }
      }
    },
    400: {
      description: "Invalid connector request.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    401: {
      description: "Connector credentials have expired.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    403: {
      description: "Connector provider denied access.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: "Connector not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "Connector connection is required.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    429: {
      description: "Connector provider rate limit exceeded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    502: {
      description: "Connector provider request failed.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    503: {
      description: "Connector provider is unavailable.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const deleteConnectorConnectionRoute = createRoute({
  method: "delete",
  path: "/api/connectors/{connectorId}/connection",
  tags: ["Connectors"],
  summary: "Disconnect connector",
  description: "Revokes provider access when supported and marks the local connector connection disconnected for this Monet install.",
  request: {
    params: connectorIdParamSchema
  },
  responses: {
    200: {
      description: "Connector disconnected successfully.",
      content: {
        "application/json": {
          schema: DisconnectConnectorConnectionResponseSchema
        }
      }
    },
    400: {
      description: "Invalid connector request.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    401: {
      description: "Connector credentials have expired.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    403: {
      description: "Connector provider denied access.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: "Connector not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "Connector connection conflict.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    429: {
      description: "Connector provider rate limit exceeded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    502: {
      description: "Connector provider request failed.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    503: {
      description: "Connector provider is unavailable.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

export function registerConnectorRoutes(
  app: ControllerApp,
  options: { connectorService: ConnectorService; getChatStorage: () => ChatStorage }
) {
  app.get("/connectors", (context) => {
    const status = context.req.query("connector_oauth")?.trim();
    const connectorId = context.req.query("connector_id")?.trim();
    const title = status === "connected" ? "Connector connected" : status === "pending" ? "Connector authorization pending" : "Connector authorization finished";
    const message =
      status === "connected"
        ? `${connectorId ? `${connectorId} is connected. ` : ""}Return to Monet to continue.`
        : status === "pending"
          ? `${connectorId ? `${connectorId} authorization is pending. ` : ""}Return to Monet to refresh connector status.`
          : "Return to Monet to check connector status.";

    return context.html(createConnectorOAuthReturnPage(title, message), 200);
  });

  app.get("/connectors/oauth/callback/:connectorId", async (context) => {
    const storage = options.getChatStorage();
    const connectorId = context.req.param("connectorId");
    const state = context.req.query("state");
    const providerConnectionId = getProviderConnectionIdFromCallback(context);

    if (!state || state.length > 512 || !providerConnectionId || providerConnectionId.length > 512 || !getConnectorCatalogItem(connectorId)) {
      return redirectToConnectors(context, "error");
    }

    const oauthState = storage.getConnectorOAuthStateByHash(hashConnectorOAuthState(state));

    if (
      !oauthState ||
      oauthState.connectorId !== connectorId ||
      oauthState.provider !== CONNECTOR_OAUTH_PROVIDER ||
      oauthState.userId !== storage.getMonetInstallId() ||
      oauthState.consumedAt ||
      Date.parse(oauthState.expiresAt) <= Date.now()
    ) {
      return redirectToConnectors(context, "error");
    }

    try {
      const callbackStatus = getCallbackCompletionStatus(context);
      const reconciledConnection = await options.connectorService.completeConnection({
        userId: oauthState.userId,
        connectorId,
        providerConnectionId,
        ...(callbackStatus ? { callbackStatus } : {}),
        abortSignal: context.req.raw.signal
      });

      storage.completeConnectorOAuthConnection({
        oauthStateId: oauthState.id,
        userId: oauthState.userId,
        connectorId: oauthState.connectorId,
        provider: oauthState.provider,
        providerConnectionId: reconciledConnection.persistence.providerConnectionId,
        providerMetadataJson: reconciledConnection.persistence.providerMetadataJson,
        accountLabel: reconciledConnection.persistence.accountLabel,
        status: reconciledConnection.persistence.status,
        lastConnectedAt: reconciledConnection.persistence.lastConnectedAt,
        lastError: reconciledConnection.persistence.lastError
      });

      return redirectToConnectors(context, reconciledConnection.connected ? "connected" : "pending", connectorId);
    } catch {
      return redirectToConnectors(context, "error", connectorId);
    }
  });

  app.openapi(listConnectorsRoute, async (context) => {
    const connectors = await options.connectorService.listConnectors({
      userId: options.getChatStorage().getMonetInstallId(),
      abortSignal: context.req.raw.signal
    });

    return context.json(
      {
        connectors: connectors.map((connector) => ({
          ...connector,
          featuredTools: Array.from(connector.featuredTools),
          capabilitySummaries: Array.from(connector.capabilitySummaries)
        }))
      },
      200
    );
  });

  app.openapi(getConnectorRoute, async (context) => {
    try {
      const connector = await options.connectorService.getConnector({
        userId: options.getChatStorage().getMonetInstallId(),
        connectorId: context.req.valid("param").connectorId,
        abortSignal: context.req.raw.signal
      });

      return context.json(
        {
          connector: {
            ...connector,
            featuredTools: Array.from(connector.featuredTools),
            capabilitySummaries: Array.from(connector.capabilitySummaries),
            allowedTools: Array.from(connector.allowedTools)
          }
        },
        200
      );
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error);
      const status = isConnectorRouteErrorStatus(normalized.statusCode) ? normalized.statusCode : 502;
      return context.json(createErrorResponse(normalized.code, normalized.message), status);
    }
  });

  app.openapi(startConnectorConnectionRoute, async (context) => {
    let payload: unknown = {};

    try {
      payload = await parseOptionalJsonBody(context.req);
    } catch {
      return context.json(createErrorResponse("invalid_arguments", "Malformed JSON request body."), 400);
    }

    const parsedBody = StartConnectorConnectionRequestSchema.safeParse(payload);

    if (!parsedBody.success) {
      return context.json(createErrorResponse("invalid_arguments", "Request validation failed."), 400);
    }

    try {
      const connectionStart = await options.connectorService.startConnection({
        userId: options.getChatStorage().getMonetInstallId(),
        connectorId: context.req.valid("param").connectorId,
        redirectUrl: parsedBody.data.redirectUrl ?? createDefaultOAuthCallbackUrl(context.req.url, context.req.valid("param").connectorId),
        abortSignal: context.req.raw.signal
      });

      return context.json(
        {
          connectorId: connectionStart.connectorId,
          status: connectionStart.kind,
          ...(connectionStart.providerConnectionId ? { providerConnectionId: connectionStart.providerConnectionId } : {}),
          ...(connectionStart.redirectUrl ? { redirectUrl: connectionStart.redirectUrl } : {}),
          ...(connectionStart.expiresAt ? { expiresAt: connectionStart.expiresAt } : {})
        },
        200
      );
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error);
      const status = isConnectorRouteErrorStatus(normalized.statusCode) ? normalized.statusCode : 502;
      return context.json(createErrorResponse(normalized.code, normalized.message), status);
    }
  });

  app.openapi(deleteConnectorConnectionRoute, async (context) => {
    const connectorId = context.req.valid("param").connectorId;
    const catalogItem = getConnectorCatalogItem(connectorId);

    if (!catalogItem) {
      return context.json(createErrorResponse("tool_not_found", `Unknown connector: ${connectorId}`), 404);
    }

    const storage = options.getChatStorage();
    const userId = storage.getMonetInstallId();

    try {
      await options.connectorService.disconnect({
        userId,
        connectorId,
        abortSignal: context.req.raw.signal
      });

      storage.markConnectorConnectionDisconnected({
        userId,
        connectorId,
        provider: CONNECTOR_OAUTH_PROVIDER
      });

      return context.json(
        {
          connectorId: catalogItem.id,
          status: "not_connected" as const
        },
        200
      );
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error);
      const status = isConnectorRouteErrorStatus(normalized.statusCode) ? normalized.statusCode : 502;
      return context.json(createErrorResponse(normalized.code, normalized.message), status);
    }
  });
}

async function parseOptionalJsonBody(request: { text: () => Promise<string> }) {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}

function isConnectorRouteErrorStatus(statusCode: number): statusCode is ConnectorRouteErrorStatus {
  return [400, 401, 403, 404, 409, 429, 502, 503].includes(statusCode);
}

function createDefaultOAuthCallbackUrl(requestUrl: string, connectorId: string): string {
  const url = new URL(requestUrl);

  return `${url.origin}/connectors/oauth/callback/${encodeURIComponent(connectorId)}`;
}

function getProviderConnectionIdFromCallback(context: Context): string | null {
  for (const key of ["providerConnectionId", "connectedAccountId", "connected_account_id", "connectionId", "connection_id", "account_id", "id"]) {
    const value = context.req.query(key)?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function getCallbackCompletionStatus(context: Context): string | undefined {
  return context.req.query("callbackStatus")?.trim() || context.req.query("callback_status")?.trim() || undefined;
}

function redirectToConnectors(context: Context, status: "connected" | "pending" | "error", connectorId?: string) {
  const target = connectorId
    ? `/connectors?connector_oauth=${status}&connector_id=${encodeURIComponent(connectorId)}`
    : `/connectors?connector_oauth=${status}`;

  return context.redirect(target, 302);
}

function createConnectorOAuthReturnPage(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
      main { max-width: 34rem; padding: 2rem; text-align: center; }
      h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
      p { margin: 0; color: color-mix(in srgb, CanvasText 72%, transparent); line-height: 1.5; }
      .hint { margin-top: 0.75rem; font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p class="hint">This tab will try to close automatically. If it stays open, you can close it safely.</p>
    </main>
    <script>
      window.setTimeout(() => {
        window.close();
      }, 1200);
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&#39;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
