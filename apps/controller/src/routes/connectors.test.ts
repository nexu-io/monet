import assert from "node:assert/strict";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import type { ConnectorCatalogCard, ConnectorService } from "../connectors/service";
import { registerConnectorRoutes } from "./connectors";

test("connectors endpoint returns connector catalog with status", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const catalogCard: ConnectorCatalogCard = {
    id: "github",
    displayName: "GitHub",
    description: "Access repositories and pull requests.",
    category: "developer",
    icon: "github",
    featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"],
    enabledByDefault: true,
    minimumApprovalPolicy: {
      sideEffect: "read",
      approval: "first_use"
    },
    capabilitySummaries: ["Read repository data."],
    status: "connected",
    connectedAccountLabel: "octocat"
  };

  let userIdRequested: string | null = null;

  const connectorService: ConnectorService = {
    async listConnectors(input) {
      userIdRequested = input.userId;
      return [catalogCard];
    },
    getConnector() {
      throw new Error("not used in connectors route test");
    },
    getConnection() {
      throw new Error("not used in connectors route test");
    }
  };

  const monetInstallId = "monet-install-id-123";

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors", {
    method: "GET"
  });

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(payload, {
    connectors: [
      {
        id: "github",
        displayName: "GitHub",
        description: "Access repositories and pull requests.",
        category: "developer",
        icon: "github",
        featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"],
        enabledByDefault: true,
        minimumApprovalPolicy: {
          sideEffect: "read",
          approval: "first_use"
        },
        capabilitySummaries: ["Read repository data."],
        status: "connected",
        connectedAccountLabel: "octocat"
      }
    ]
  });

  assert.equal(userIdRequested, monetInstallId);
});
