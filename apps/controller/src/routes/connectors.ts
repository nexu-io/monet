import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import { normalizeConnectorProviderError } from "../connectors/errors";
import type { ConnectorService } from "../connectors/service";
import {
  createErrorResponse,
  ErrorResponseSchema,
  GetConnectorResponseSchema,
  ListConnectorsResponseSchema
} from "../openapi";

type ConnectorRouteErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503;

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

export function registerConnectorRoutes(
  app: ControllerApp,
  options: { connectorService: ConnectorService; getChatStorage: () => ChatStorage }
) {
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
}

function isConnectorRouteErrorStatus(statusCode: number): statusCode is ConnectorRouteErrorStatus {
  return [400, 401, 403, 404, 409, 429, 502, 503].includes(statusCode);
}
