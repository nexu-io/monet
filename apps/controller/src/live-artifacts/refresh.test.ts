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
          outputMapping: { preferredKind: "json" }
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
    assert.deepEqual(result.artifact.document?.dataJson, { summary: "fresh issues" });

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
        createConnectorSource("github_search_repositories", { q: "agent stars:>1000", sort: "stars", order: "desc", per_page: 2 })
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
        sourceJson: createConnectorSource("github_search_repositories", { q: "agent stars:>1000", sort: "stars", order: "desc", per_page: 2 }),
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

    const dataJson = result.artifact.document?.dataJson as { repos: Array<{ name: string; owner: string; stars: string; c1: string }> };
    assert.equal(dataJson.repos[0]?.name, "crewAI");
    assert.equal(dataJson.repos[0]?.owner, "crewAIInc");
    assert.equal(dataJson.repos[0]?.stars, "50.1k");
    assert.equal(dataJson.repos[0]?.c1, "#fff");
    assert.equal(dataJson.repos[1]?.name, "khoj");
  } finally {
    fixture.cleanup();
  }
});

test("live artifact refresh fails closed for stale connector metadata", async () => {
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
    }), /Connector refresh source provider tool ID is stale: github_stale/);

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
    outputMapping: { preferredKind: "json" as const }
  };
}

function createConnectorDefinition(
  name: string,
  options: {
    providerToolId: string;
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
        connectorId: "github",
        connectorName: "GitHub",
        accountLabel: options.accountLabel ?? "octocat",
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
