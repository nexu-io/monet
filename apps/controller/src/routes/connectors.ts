import { createRoute } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import type { ConnectorService } from "../connectors/service";
import { ListConnectorsResponseSchema } from "../openapi";

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
}
