import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIVE_ARTIFACT_LIMITS, LiveArtifactTileSourceSchema } from "./schema";

describe("live artifact tile source input validation", () => {
  const baseSource = {
    type: "connector_tool",
    toolName: "github_search_issues",
    connector: {
      connectorId: "github",
      connectorName: "GitHub",
      accountLabel: "octo-org",
      providerToolId: "github.search_issues"
    },
    refreshPermission: "manual_refresh_granted_for_read_only",
    outputMapping: { preferredKind: "table", dataPaths: { issues: "items" } }
  } as const;

  it("persists stable repeatable query arguments and trims inline strings", () => {
    const source = LiveArtifactTileSourceSchema.parse({
      ...baseSource,
      input: {
        query: "  is:open repo:acme/app label:bug  ",
        limit: 25,
        filters: { since: "2026-04-01", status: "open" }
      }
    });

    assert.deepEqual(source.input, {
      query: "is:open repo:acme/app label:bug",
      limit: 25,
      filters: { since: "2026-04-01", status: "open" }
    });
  });

  it("rejects credential and token fields using chat-storage redaction patterns", () => {
    assert.throws(
      () =>
        LiveArtifactTileSourceSchema.parse({
          ...baseSource,
          input: { query: "status:open", access_token: "secret-token" }
        }),
      /credential or token fields/
    );

    assert.throws(
      () =>
        LiveArtifactTileSourceSchema.parse({
          ...baseSource,
          input: { url: "https:\/\/api.example.test\/items?api_key=secret" }
        }),
      /credentials or tokens/
    );
  });

  it("rejects raw provider responses instead of storing them as source input", () => {
    assert.throws(
      () =>
        LiveArtifactTileSourceSchema.parse({
          ...baseSource,
          input: {
            query: "status:open",
            response: { items: [{ id: "issue-1", title: "raw provider response" }] }
          }
        }),
      /raw provider responses/
    );
  });

  it("rejects broad personal data when a stable query filter should be stored instead", () => {
    assert.throws(
      () =>
        LiveArtifactTileSourceSchema.parse({
          ...baseSource,
          input: {
            query: "from:customer@example.test",
            messages: [{ from: "customer@example.test", body: "private message body" }]
          }
        }),
      /minimize broad personal data/
    );
  });

  it("enforces source input and source JSON byte budgets", () => {
    assert.throws(
      () =>
        LiveArtifactTileSourceSchema.parse({
          ...baseSource,
          input: { query: "x".repeat(LIVE_ARTIFACT_LIMITS.sourceInputBytes) }
        }),
      /Tile source input exceeds max size/
    );
  });

  it("validates generic output data path mappings", () => {
    const source = LiveArtifactTileSourceSchema.parse({
      ...baseSource,
      input: { query: "status:open" },
      outputMapping: {
        preferredKind: "json",
        dataPaths: {
          "summary.count": "items.0.count",
          status: ["state", "status"],
          amount: "$.available.0.amount"
        }
      }
    });

    assert.deepEqual(source.outputMapping.dataPaths, {
      "summary.count": "items.0.count",
      status: ["state", "status"],
      amount: "$.available.0.amount"
    });

    assert.throws(
      () => LiveArtifactTileSourceSchema.parse({
        ...baseSource,
        input: { query: "status:open" },
        outputMapping: { preferredKind: "json", dataPaths: { "items.0.title": "title" } }
      }),
      /Destination path must use object dot notation/
    );

    assert.throws(
      () => LiveArtifactTileSourceSchema.parse({
        ...baseSource,
        input: { query: "status:open" },
        outputMapping: { preferredKind: "json", dataPaths: { safe: "__proto__.polluted" } }
      }),
      /prototype-sensitive/
    );
  });
});
