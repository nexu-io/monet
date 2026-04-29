import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIVE_ARTIFACT_LIMITS, LiveArtifactProvenanceJsonSchema } from "./schema";

describe("live artifact provenance sanitization", () => {
  it("stores only bounded redacted provenance summaries", () => {
    const provenance = LiveArtifactProvenanceJsonSchema.parse({
      generatedAt: "2026-04-28T12:00:00.000Z",
      sources: [
        {
          type: "connector_tool",
          label: "GitHub issues",
          toolName: "github_search_issues",
          connector: {
            connectorId: "github",
            connectorName: "GitHub",
            accountLabel: "https://api.example.test/me?api_key=secret-api-token",
            providerToolId: "github.search_issues"
          },
          querySummary: "https://api.example.test/search?q=repo:acme/app&api_key=secret-key",
          recordCount: 12,
          refreshedAt: "2026-04-28T12:00:00.000Z"
        }
      ],
      notes: ["Created from summarized connector output with Bearer secret-token"]
    });

    assert.equal(provenance.sources[0]?.connector?.accountLabel, "https://api.example.test/me?api_key=[redacted]");
    assert.equal(provenance.sources[0]?.querySummary, "https://api.example.test/search?q=repo:acme/app&api_key=[redacted]");
    assert.equal(provenance.notes?.[0], "Created from summarized connector output with [redacted]");
  });

  it("rejects unbounded provenance", () => {
    assert.throws(
      () =>
        LiveArtifactProvenanceJsonSchema.parse({
          sources: Array.from({ length: LIVE_ARTIFACT_LIMITS.provenanceSources + 1 }, (_, index) => ({
            type: "static",
            label: `Source ${index}`
          }))
        }),
      /Too big|Array must contain at most/
    );

    assert.throws(
      () =>
        LiveArtifactProvenanceJsonSchema.parse({
          sources: [
            {
              type: "static",
              querySummary: "x".repeat(LIVE_ARTIFACT_LIMITS.provenanceJsonBytes)
            }
          ]
        }),
      /Provenance JSON exceeds max size|String must contain at most/
    );
  });

  it("does not accept raw provider response fields as provenance", () => {
    assert.throws(
      () =>
        LiveArtifactProvenanceJsonSchema.parse({
          sources: [{ type: "tool", label: "Search" }],
          response: { items: [{ id: "raw-1" }] }
        }),
      /Unrecognized key|unrecognized_keys/
    );
  });
});
