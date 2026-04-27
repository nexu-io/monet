import assert from "node:assert/strict";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createConnectorProviderError } from "../connectors/errors";
import type { ConnectorCatalogCard, ConnectorDetail, ConnectorService } from "../connectors/service";
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

test("connector detail endpoint returns connector status, tools, and approval policies", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const connectorDetail: ConnectorDetail = {
    id: "github",
    providerConnectorId: "GITHUB",
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
    connectedAccountLabel: "octocat",
    connection: {
      status: "connected",
      connected: true,
      connectedAccountLabel: "octocat",
      account: {
        accountLabel: "octocat",
        providerConnectionId: "conn_123",
        providerConnectorId: "GITHUB"
      }
    },
    allowedTools: [
      {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        displayName: "Search issues and pull requests",
        summary: "Search issues and pull requests across accessible repositories.",
        policy: {
          sideEffect: "read",
          approval: "first_use"
        }
      }
    ]
  };

  let requested: { userId: string; connectorId: string } | null = null;

  const connectorService: ConnectorService = {
    listConnectors() {
      throw new Error("not used in connector detail route test");
    },
    async getConnector(input) {
      requested = { userId: input.userId, connectorId: input.connectorId };
      return connectorDetail;
    },
    getConnection() {
      throw new Error("not used in connector detail route test");
    }
  };

  const monetInstallId = "monet-install-id-456";

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return monetInstallId;
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/github", {
    method: "GET"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connector: connectorDetail });
  assert.deepEqual(requested, { userId: monetInstallId, connectorId: "github" });
});

test("connector detail endpoint returns normalized connector errors", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();

  const connectorService: ConnectorService = {
    listConnectors() {
      throw new Error("not used in connector detail error route test");
    },
    getConnector() {
      throw createConnectorProviderError("tool_not_found", { message: "Unknown connector: missing" });
    },
    getConnection() {
      throw new Error("not used in connector detail error route test");
    }
  };

  registerConnectorRoutes(app, {
    connectorService,
    getChatStorage: () =>
      ({
        getMonetInstallId() {
          return "monet-install-id-789";
        }
      }) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/connectors/missing", {
    method: "GET"
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "tool_not_found",
    message: "Unknown connector: missing"
  });
});
