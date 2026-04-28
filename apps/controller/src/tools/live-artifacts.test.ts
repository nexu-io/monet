import assert from "node:assert/strict";
import test from "node:test";

import { createLiveArtifactToolDefinitions } from "./live-artifacts";
import type { LiveArtifactWithTiles } from "../live-artifacts/schema";

type ParsableSchema = { parse(input: unknown): unknown };

function getLiveArtifactTools() {
  return Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {} as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
}

const sampleArtifact: LiveArtifactWithTiles = {
  id: "art_123",
  schemaVersion: 1,
  sessionId: "ses_test",
  createdByRunId: "run_test",
  createdByToolCallId: "tcl_test",
  title: "Revenue dashboard",
  slug: "revenue-dashboard",
  description: "Daily revenue summary",
  contentType: "html_page_v1",
  currentRevisionId: null,
  status: "active",
  pinned: false,
  refreshStatus: "idle",
  refreshStartedAt: null,
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
  lastRefreshedAt: null,
  lastRefreshError: null,
  document: {
    format: "html_template_v1",
    sanitizedHtml: "<main>Revenue dashboard</main>",
    dataJson: {},
    sanitizerVersion: "basic-html-v1"
  },
  tiles: [{
    id: "tile_123",
    artifactId: "art_123",
    schemaVersion: 1,
    position: 0,
    title: "Revenue",
    kind: "metric",
    renderJson: {
      kind: "metric",
      label: "Revenue",
      value: "$42"
    },
    provenanceJson: {
      generatedAt: "2026-04-28T00:00:00.000Z",
      sources: [{
        type: "connector_tool",
        label: "Stripe balance",
        toolName: "stripe_get_balance",
        connector: {
          connectorId: "stripe",
          connectorName: "Stripe",
          accountLabel: "Acme Stripe",
          providerToolId: "stripe.get_balance"
        },
        querySummary: "Current balance only",
        recordCount: 1,
        refreshedAt: "2026-04-28T00:00:00.000Z"
      }]
    },
    sourceJson: null,
    refreshStatus: "idle",
    refreshStartedAt: null,
    lastRefreshedAt: null,
    lastError: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  }]
};

const toolExecutionContext = {
  persistedToolCallId: "tcl_test",
  sessionId: "ses_test",
  sessionWorkspacePath: "/tmp/session",
  setConnectorExecutionMetadata() {},
  toolCallId: "call_test",
  messages: [],
  abortSignal: new AbortController().signal
};

const connectorTileSource = {
  type: "connector_tool",
  toolName: "github_search_issues",
  connector: {
    connectorId: "github",
    connectorName: "GitHub",
    accountLabel: "octo-org",
    providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"
  },
  refreshPermission: "manual_refresh_granted_for_read_only",
  outputMapping: { preferredKind: "table" }
} as const;

test("create_live_artifact auto-executes without confirmation", () => {
  const tools = getLiveArtifactTools();
  const createTool = tools.create_live_artifact;

  assert.ok(createTool);
  assert.equal(createTool.metadata.requiresConfirmation, false);
});

test("update_live_artifact stays low-friction for title or description edits", () => {
  const tools = getLiveArtifactTools();
  const updateTool = tools.update_live_artifact;

  assert.ok(updateTool);

  assert.equal(updateTool.metadata.requiresConfirmation, false);
});

test("update_live_artifact rejects legacy tile updates", () => {
  const tools = getLiveArtifactTools();
  const updateTool = tools.update_live_artifact;

  assert.ok(updateTool);
  assert.throws(() => (updateTool.inputSchema as ParsableSchema).parse({ artifactId: "art_123", tiles: [] }), /Unrecognized key/);
});

test("create_live_artifact returns linkable artifact identifiers and concise provenance", () => {
  const tools = Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {
        createLiveArtifact(input: { readonly createdByRunId?: string | null; readonly createdByToolCallId?: string | null }) {
          assert.equal(input.createdByRunId, "run_test");
          assert.equal(input.createdByToolCallId, "tcl_test");
          return sampleArtifact;
        }
      } as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
  const createTool = tools.create_live_artifact;

  assert.ok(createTool);
  const output = createTool.execute({
    title: "Revenue dashboard",
    description: "Daily revenue summary",
    document: {
      format: "html_template_v1",
      sanitizedHtml: "<main>Revenue</main>",
      dataJson: { revenue: "$42" }
    }
  }, toolExecutionContext) as Record<string, unknown>;

  assert.equal(output.artifactId, "art_123");
  assert.equal(output.artifactUrl, "/artifacts/art_123");
  assert.deepEqual(output.provenance, {
    createdByRunId: "run_test",
    createdByToolCallId: "tcl_test",
    hasDocument: true,
    sourceCount: 0,
    sources: []
  });
});

test("artifact tool schemas validate HTML documents", () => {
  const tools = getLiveArtifactTools();
  const createTool = tools.create_live_artifact;
  const updateTool = tools.update_live_artifact;

  assert.ok(createTool);
  assert.ok(updateTool);
  assert.throws(() => (createTool.inputSchema as ParsableSchema).parse({ title: "Missing document" }), /Required/);

  assert.throws(
    () => (updateTool.inputSchema as ParsableSchema).parse({
      artifactId: "art_123"
    }),
    /At least one update field is required/
  );

  const htmlArtifact = (createTool.inputSchema as ParsableSchema).parse({
    title: "HTML page",
    contentType: "html_page_v1",
    document: {
      format: "html_template_v1",
      sanitizedHtml: "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><title>Demo</title><style>.hero{color:red}</style></head><body><main class='hero'>{{data.title}}</main></body></html>",
      dataJson: { title: "Demo" }
    }
  }) as { document: { sanitizedHtml: string } };

  assert.equal(htmlArtifact.document.sanitizedHtml, "<style>.hero{color:red}</style>\n<main class='hero'>{{data.title}}</main>");

  const permissiveHtmlArtifact = (createTool.inputSchema as ParsableSchema).parse({
    title: "Permissive HTML page",
    contentType: "html_page_v1",
    document: {
      format: "html_template_v1",
      sanitizedHtml: "<!doctype html><html><head><script>window.__x=1</script></head><body><main onclick='alert(1)'>Allowed in storage; sandbox blocks execution</main></body></html>",
      dataJson: {}
    }
  }) as { document: { sanitizedHtml: string } };

  assert.match(permissiveHtmlArtifact.document.sanitizedHtml, /onclick='alert\(1\)'/);
});

test("artifact tools sanitize document source input before persistence", () => {
  const tools = Object.fromEntries(
    createLiveArtifactToolDefinitions({
      chatStorage: {
        createLiveArtifact(input: { readonly document?: { readonly sourceJson?: unknown } }) {
          assert.deepEqual(input.document?.sourceJson, {
            ...connectorTileSource,
            input: {
              query: "is:open repo:acme/app",
              filters: { since: "2026-04-01", status: "open" },
              limit: 10
            }
          });
          return sampleArtifact;
        }
      } as never,
      runId: "run_test",
      sessionId: "ses_test"
    }).map((definition) => [definition.metadata.name, definition])
  );
  const createTool = tools.create_live_artifact;
  assert.ok(createTool);

  createTool.execute({
    title: "Open issues",
    document: {
      format: "html_template_v1",
      sanitizedHtml: "<main>Issues</main>",
      dataJson: {},
      sourceJson: {
        ...connectorTileSource,
        input: {
          query: "  is:open repo:acme/app  ",
          filters: { since: "2026-04-01", status: "open" },
          limit: 10
        }
      }
    }
  }, toolExecutionContext);
});

test("list_live_artifacts and update_live_artifact are read-only or low-friction", () => {
  const tools = getLiveArtifactTools();
  const listTool = tools.list_live_artifacts;
  const updateTool = tools.update_live_artifact;

  assert.ok(listTool);
  assert.ok(updateTool);
  assert.equal(listTool.metadata.requiresConfirmation, false);
  assert.equal(listTool.needsApproval, undefined);
  assert.equal(updateTool.metadata.requiresConfirmation, false);
  assert.equal(updateTool.needsApproval, undefined);
});
