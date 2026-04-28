import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import { createToolRegistry } from "../tools/registry";
import { refreshLiveArtifact } from "./refresh";
import type { LiveArtifactCreateInput, LiveArtifactJsonValue, LiveArtifactTileSource } from "./schema";

function createStorageFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-live-artifact-refresh-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");

  mkdirSync(workspaceDir, { recursive: true });

  return {
    databasePath,
    fixtureDir,
    workspaceDir,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function createStorage(databasePath: string) {
  return createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    }
  });
}

test("html page live artifact refresh updates data JSON and advances document revision", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      title: "HTML report",
      description: null,
      contentType: "html_page_v1",
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main><h1>{{data.title}}</h1><p>{{data.count}}</p></main>",
        dataJson: { title: "Previous", count: 1 },
        sourceJson: {
          type: "tool",
          toolName: "get_report_data",
          input: { reportId: "rep_123" },
          refreshPermission: "manual_refresh_granted_for_read_only",
          outputMapping: { preferredKind: "json", dataPaths: { title: "dataJson.title", count: "dataJson.count", items: "dataJson.items" } }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const previousRevisionId = artifact.currentRevisionId;
    const registry = createToolRegistry([
      {
        metadata: {
          name: "get_report_data",
          description: "Return report data",
          requiresConfirmation: false
        },
        inputSchema: {},
        execute() {
          return { dataJson: { title: "Updated", count: 42, items: ["a", "b"] } };
        }
      }
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.deepEqual(result.failures, []);
    assert.equal(result.artifact.contentType, "html_page_v1");
    assert.notEqual(result.artifact.currentRevisionId, previousRevisionId);
    assert.deepEqual(result.artifact.document?.dataJson, { title: "Updated", count: 42, items: ["a", "b"] });
    assert.equal(result.artifact.document?.sanitizedHtml, artifact.document?.sanitizedHtml);
    assert.equal(result.artifact.document?.sourceJson?.toolName, "get_report_data");
    assert.equal(result.artifact.lastRefreshError, null);

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const documentCount = connection
        .prepare("SELECT COUNT(*) AS count FROM live_artifact_documents WHERE artifact_id = ?")
        .get(artifact.id) as { count: number };
      const step = connection
        .prepare("SELECT tile_id, status, tool_name FROM live_artifact_refresh_steps ORDER BY started_at DESC LIMIT 1")
        .get() as { tile_id: string | null; status: string; tool_name: string };

      assert.equal(documentCount.count, 2);
      assert.equal(step.tile_id, null);
      assert.equal(step.status, "completed");
      assert.equal(step.tool_name, "get_report_data");
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh validates connector source metadata before execution", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload(
      "Connector report",
      createConnectorSource("github_search_issues", { query: "repo:acme/widgets is:open" })
    ));

    let executions = 0;
    const registry = createToolRegistry([
      {
        metadata: {
          name: "github_search_issues",
          description: "Search issues",
          requiresConfirmation: false,
          connector: {
            connectorId: "github",
            connectorName: "GitHub",
            accountLabel: "octocat",
            connectionState: "connected",
            connected: true,
            toolName: "Search issues and pull requests",
            providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
            approvalPolicy: { sideEffect: "read", approval: "never" }
          }
        },
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false
        },
        execute() {
          executions += 1;
          return { dataJson: { summary: "fresh issues" } };
        }
      }
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.equal(executions, 1);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.artifact.document?.dataJson, { title: "Connector report", summary: "fresh issues" });

    const connection = new DatabaseSync(fixture.databasePath);
    try {
      const step = connection
        .prepare("SELECT tile_id, connector_id, connector_account_label, connector_provider_tool_id, approval_basis FROM live_artifact_refresh_steps LIMIT 1")
        .get() as {
          tile_id: string | null;
          connector_id: string;
          connector_account_label: string;
          connector_provider_tool_id: string;
          approval_basis: string;
        };

      assert.equal(step.tile_id, null);
      assert.equal(step.connector_id, "github");
      assert.equal(step.connector_account_label, "octocat");
      assert.equal(step.connector_provider_tool_id, "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS");
      assert.equal(step.approval_basis, "manual_refresh_granted_for_read_only");
    } finally {
      connection.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("html artifact refresh remaps connector repository output into existing template data", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload(
        "GitHub repos",
        {
          ...createConnectorSource("github_search_repositories", { q: "agent stars:>1000", sort: "stars", order: "desc", per_page: 2 }),
          outputMapping: { preferredKind: "json", dataPaths: { repos: "items" } }
        }
      ),
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main data-repeat='repos' data-as='r'><a data-bind-attr='href:r.url'><span data-bind='text:r.name'></span></a></main>",
        dataJson: {
          badge: "TOP 2 · LIVE",
          repos: [
            { rank: "01", name: "Old", owner: "old", url: "#", avatar: "", description: "old", topics: [], stars: "0", forks: "0", language: "Unknown", c1: "#fff" },
            { rank: "02", name: "Old 2", owner: "old", url: "#", avatar: "", description: "old", topics: [], stars: "0", forks: "0", language: "Unknown", c1: "#000" }
          ]
        },
        sourceJson: {
          ...createConnectorSource("github_search_repositories", { q: "agent stars:>1000", sort: "stars", order: "desc", per_page: 2 }),
          outputMapping: { preferredKind: "json", dataPaths: { repos: "items" } }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const registry = createToolRegistry([
      createConnectorDefinition("github_search_repositories", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        inputSchema: { type: "object" },
        execute() {
          return {
            items: [
              {
                name: "crewAI",
                full_name: "crewAIInc/crewAI",
                html_url: "https://github.com/crewAIInc/crewAI",
                description: "Agent framework",
                stargazers_count: 50123,
                forks_count: 6897,
                language: "Python",
                topics: ["agents", "ai"],
                owner: { login: "crewAIInc", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" }
              },
              {
                name: "khoj",
                full_name: "khoj-ai/khoj",
                html_url: "https://github.com/khoj-ai/khoj",
                description: "AI second brain",
                stargazers_count: 34300,
                forks_count: 2200,
                language: "Python",
                topics: ["rag"],
                owner: { login: "khoj-ai", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" }
              }
            ]
          };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    const dataJson = result.artifact.document?.dataJson as { repos: Array<{ name: string; stargazers_count: number }> };
    assert.equal(dataJson.repos[0]?.name, "crewAI");
    assert.equal(dataJson.repos[0]?.stargazers_count, 50123);
    assert.equal(dataJson.repos[1]?.name, "khoj");
  } finally {
    fixture.cleanup();
  }
});

test("html artifact refresh maps single repository output into bound data", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload(
        "nexu-io/open-design Stars",
        createConnectorSource("github_get_a_repository", { owner: "nexu-io", repo: "open-design" })
      ),
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main><div class=\"repo\">{{data.owner}}/{{data.repo}}</div><div class=\"stars\">{{data.stars}}</div></main>",
        dataJson: { owner: "nexu-io", repo: "open-design", stars: 166 },
        dataSchemaJson: { owner: "string", repo: "string", stars: "number" },
        sourceJson: {
          ...createConnectorSource("github_get_a_repository", { owner: "nexu-io", repo: "open-design" }),
          outputMapping: {
            preferredKind: "json",
            dataPaths: {
              owner: "owner.login",
              repo: "name",
              stars: ["stargazers_count", "watchers_count"]
            }
          }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const registry = createToolRegistry([
      createConnectorDefinition("github_get_a_repository", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        inputSchema: { type: "object" },
        execute() {
          return {
            name: "open-design",
            full_name: "nexu-io/open-design",
            stargazers_count: 304,
            watchers_count: 304,
            owner: { login: "nexu-io" }
          };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.deepEqual(result.artifact.document?.dataJson, { owner: "nexu-io", repo: "open-design", stars: 304 });
    assert.equal(result.artifact.document?.sanitizedHtml, "<main><div class=\"repo\">{{data.owner}}/{{data.repo}}</div><div class=\"stars\">{{data.stars}}</div></main>");
  } finally {
    fixture.cleanup();
  }
});

test("html artifact refresh maps arbitrary connector output paths into bound data", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const source = createConnectorSource("stripe_get_balance", { account: "acct_123" });
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload("Stripe balance", source),
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main><strong>{{data.balance.amount}}</strong><span>{{data.balance.currency}}</span></main>",
        dataJson: { balance: { amount: 0, currency: "usd" } },
        sourceJson: {
          ...source,
          connector: {
            connectorId: "stripe",
            connectorName: "Stripe",
            accountLabel: "acct_123",
            providerToolId: "STRIPE_GET_BALANCE"
          },
          outputMapping: {
            preferredKind: "json",
            dataPaths: {
              "balance.amount": "$.available.0.amount",
              "balance.currency": ["available.0.currency", "currency"]
            }
          }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const registry = createToolRegistry([
      createConnectorDefinition("stripe_get_balance", {
        connectorId: "stripe",
        connectorName: "Stripe",
        accountLabel: "acct_123",
        providerToolId: "STRIPE_GET_BALANCE",
        connected: true,
        connectionState: "connected",
        inputSchema: { type: "object" },
        execute() {
          return { available: [{ amount: 4200, currency: "usd" }] };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.deepEqual(result.artifact.document?.dataJson, { balance: { amount: 4200, currency: "usd" } });
    assert.equal(result.artifact.document?.sanitizedHtml, "<main><strong>{{data.balance.amount}}</strong><span>{{data.balance.currency}}</span></main>");
  } finally {
    fixture.cleanup();
  }
});

test("html artifact refresh fails when configured data paths do not match output", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const source = createConnectorSource("stripe_get_balance", { account: "acct_123" });
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload("Stripe balance", source),
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main>{{data.balance.amount}}</main>",
        dataJson: { balance: { amount: 0 } },
        sourceJson: {
          ...source,
          connector: {
            connectorId: "stripe",
            connectorName: "Stripe",
            accountLabel: "acct_123",
            providerToolId: "STRIPE_GET_BALANCE"
          },
          outputMapping: {
            preferredKind: "json",
            dataPaths: { "balance.amount": "missing.amount" }
          }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const registry = createToolRegistry([
      createConnectorDefinition("stripe_get_balance", {
        connectorId: "stripe",
        connectorName: "Stripe",
        accountLabel: "acct_123",
        providerToolId: "STRIPE_GET_BALANCE",
        connected: true,
        connectionState: "connected",
        inputSchema: { type: "object" },
        execute() {
          return { available: [{ amount: 4200 }] };
        }
      })
    ]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Refresh output did not match any configured data path mappings/);

    const unchanged = storage.getLiveArtifact(artifact.id);
    assert.deepEqual(unchanged.document?.dataJson, { balance: { amount: 0 } });
  } finally {
    fixture.cleanup();
  }
});

test("html artifact refresh fails when any configured data path is missing", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const source = createConnectorSource("stripe_get_balance", { account: "acct_123" });
    const artifact = storage.createLiveArtifact({
      ...createHtmlArtifactPayload("Stripe balance", source),
      document: {
        format: "html_template_v1",
        sanitizedHtml: "<main>{{data.balance.amount}} {{data.balance.currency}}</main>",
        dataJson: { balance: { amount: 0, currency: "usd" } },
        sourceJson: {
          ...source,
          connector: {
            connectorId: "stripe",
            connectorName: "Stripe",
            accountLabel: "acct_123",
            providerToolId: "STRIPE_GET_BALANCE"
          },
          outputMapping: {
            preferredKind: "json",
            dataPaths: {
              "balance.amount": "available.0.amount",
              "balance.currency": "available.0.currency"
            }
          }
        },
        sanitizerVersion: "basic-html-v1"
      }
    });
    const registry = createToolRegistry([
      createConnectorDefinition("stripe_get_balance", {
        connectorId: "stripe",
        connectorName: "Stripe",
        accountLabel: "acct_123",
        providerToolId: "STRIPE_GET_BALANCE",
        connected: true,
        connectionState: "connected",
        inputSchema: { type: "object" },
        execute() {
          return { available: [{ amount: 4200 }] };
        }
      })
    ]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Refresh output is missing configured data path mappings: balance\.currency/);

    const unchanged = storage.getLiveArtifact(artifact.id);
    assert.deepEqual(unchanged.document?.dataJson, { balance: { amount: 0, currency: "usd" } });
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh tolerates stale connector provider tool metadata", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload("Connector report", {
      ...createConnectorSource("github_stale", { query: "is:open" }),
      connector: {
        connectorId: "github",
        connectorName: "GitHub",
        accountLabel: "octocat",
        providerToolId: "GITHUB_OLD_TOOL"
      }
    }));

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_stale", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        execute() {
          executions += 1;
          return { summary: "fresh issues" };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.equal(executions, 1);
    assert.deepEqual(result.failures, []);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh tolerates missing current connector account labels", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload("Connector report", createConnectorSource("github_missing_account_label", { query: "is:open" })));

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_missing_account_label", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        accountLabel: null,
        execute() {
          executions += 1;
          return { dataJson: { summary: "fresh issues" } };
        }
      })
    ]);

    const result = await refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    });

    assert.equal(executions, 1);
    assert.deepEqual(result.failures, []);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh blocks connector account label changes", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload("Connector report", {
      ...createConnectorSource("github_changed_account_label", { query: "is:open" }),
      connector: {
        connectorId: "github",
        connectorName: "GitHub",
        accountLabel: "old-octocat",
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
      }
    }));

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_changed_account_label", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        accountLabel: "new-octocat",
        execute() {
          executions += 1;
          return { dataJson: { summary: "fresh issues" } };
        }
      })
    ]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Connector refresh source account is stale: github_changed_account_label/);

    assert.equal(executions, 0);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh fails closed for current schema mismatch", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload(
      "Connector report",
      createConnectorSource("github_schema", { oldQuery: "is:open" })
    ));

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_schema", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false
        },
        execute() {
          executions += 1;
          return { ok: true };
        }
      })
    ]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Refresh source input no longer matches current tool schema for github_schema: input\.query is required by the current tool schema/);

    assert.equal(executions, 0);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh rejects unsafe connector sources before execution", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload(
      "Unsafe connector report",
      createConnectorSource("github_write", { query: "is:open" })
    ));

    let executions = 0;
    const registry = createToolRegistry([
      createConnectorDefinition("github_write", {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        connected: true,
        connectionState: "connected",
        approvalPolicy: { sideEffect: "write", approval: "always" },
        execute() {
          executions += 1;
          return { ok: true };
        }
      })
    ]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Connector refresh source is not currently classified as read-only: github_write/);

    assert.equal(executions, 0);
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh blocks connector execution when current audit metadata is missing", async () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const artifact = storage.createLiveArtifact(createHtmlArtifactPayload(
      "Connector audit report",
      createConnectorSource("github_search_issues", { query: "repo:acme/widgets is:open" })
    ));

    let executions = 0;
    const registry = createToolRegistry([{
      metadata: {
        name: "github_search_issues",
        description: "Search issues",
        requiresConfirmation: false
      },
      inputSchema: {},
      execute() {
        executions += 1;
        return { ok: true };
      }
    }]);

    await assert.rejects(() => refreshLiveArtifact({
      artifactId: artifact.id,
      chatStorage: storage,
      toolRegistry: registry,
      sessionWorkspacePath: fixture.workspaceDir,
      logger: createLogger("test", { component: "live-artifact-refresh-test" })
    }), /Connector refresh source is missing audit metadata: github_search_issues/);

    assert.equal(executions, 0);
  } finally {
    fixture.cleanup();
  }
});

function createHtmlArtifactPayload(title: string, sourceJson?: LiveArtifactTileSource): LiveArtifactCreateInput {
  return {
    title,
    description: null,
    contentType: "html_page_v1" as const,
    document: {
      format: "html_template_v1" as const,
      sanitizedHtml: "<main><h1>{{data.title}}</h1></main>",
      dataJson: { title },
      ...(sourceJson ? { sourceJson } : {}),
      sanitizerVersion: "basic-html-v1"
    }
  };
}

function createConnectorSource(toolName: string, input: Record<string, LiveArtifactJsonValue>): LiveArtifactTileSource {
  return {
    type: "connector_tool" as const,
    toolName,
    input,
    connector: {
      connectorId: "github",
      connectorName: "GitHub",
      accountLabel: "octocat",
      providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
    },
    refreshPermission: "manual_refresh_granted_for_read_only" as const,
    outputMapping: { preferredKind: "json" as const, dataPaths: { summary: ["summary", "dataJson.summary"] } }
  };
}

function createConnectorDefinition(
  name: string,
  options: {
    providerToolId: string;
    connectorId?: string;
    connectorName?: string;
    connected: boolean;
    connectionState: string;
    accountLabel?: string | null;
    approvalPolicy?: { sideEffect: string; approval: string } | null;
    inputSchema?: Record<string, unknown>;
    execute: () => unknown;
  }
) {
  return {
    metadata: {
      name,
      description: "Connector test tool",
      requiresConfirmation: false,
      connector: {
        connectorId: options.connectorId ?? "github",
        connectorName: options.connectorName ?? "GitHub",
        accountLabel: options.accountLabel === undefined ? "octocat" : options.accountLabel,
        connectionState: options.connectionState,
        connected: options.connected,
        toolName: "Search issues and pull requests",
        providerToolId: options.providerToolId,
        approvalPolicy: options.approvalPolicy === null
          ? (undefined as never)
          : (options.approvalPolicy ?? { sideEffect: "read", approval: "never" })
      }
    },
    inputSchema: options.inputSchema ?? {},
    execute: options.execute
  };
}
