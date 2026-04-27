import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LIVE_ARTIFACT_LIMITS } from "./schema";
import { sanitizeLiveArtifactRefreshRenderJson, sanitizeLiveArtifactRenderJson } from "./render";

describe("live artifact render JSON sanitization", () => {
  it("accepts sanitized render JSON and trims safe text", () => {
    const renderJson = sanitizeLiveArtifactRenderJson({
      kind: "metric",
      label: "  Total revenue ",
      value: " $10 ",
      caption: "updated today",
      trend: "up"
    });

    assert.deepEqual(renderJson, {
      kind: "metric",
      label: "Total revenue",
      value: "$10",
      caption: "updated today",
      trend: "up"
    });
  });

  it("rejects markdown containing raw HTML or script-like content", () => {
    assert.throws(
      () => sanitizeLiveArtifactRenderJson({ kind: "markdown", markdown: "# Unsafe\n<script>alert(1)</script>" }),
      /Script-like content|Raw HTML content/
    );

    assert.throws(
      () => sanitizeLiveArtifactRenderJson({ kind: "markdown", markdown: "<div>raw html</div>" }),
      /Raw HTML content/
    );
  });

  it("allows only http and https URLs", () => {
    const linkCard = sanitizeLiveArtifactRenderJson({ kind: "link_card", title: "Docs", url: "https://example.com/docs" });
    assert.equal(linkCard.kind, "link_card");
    assert.equal(
      linkCard.url,
      "https://example.com/docs"
    );

    assert.throws(
      () => sanitizeLiveArtifactRenderJson({ kind: "link_card", title: "Bad", url: "javascript:alert(1)" }),
      /Only http and https URLs are allowed|Invalid url/
    );
  });

  it("enforces the whole render JSON byte budget", () => {
    assert.throws(
      () => sanitizeLiveArtifactRenderJson({ kind: "json", value: "x".repeat(LIVE_ARTIFACT_LIMITS.renderJsonBytes) }),
      /Render JSON exceeds max size/
    );
  });

  it("preserves previous render JSON on invalid refresh output", () => {
    const previous = sanitizeLiveArtifactRenderJson({ kind: "markdown", markdown: "# Previous" });
    const result = sanitizeLiveArtifactRefreshRenderJson(
      { kind: "markdown", markdown: "<iframe src=\"https://evil.example\"></iframe>" },
      previous
    );

    assert.equal(result.ok, false);
    assert.equal(result.preservedPrevious, true);
    assert.deepEqual(result.renderJson, previous);
    assert.match(result.error, /Raw HTML content|Script-like content/);
  });

  it("returns no preserved value when refresh output and previous render JSON are invalid", () => {
    const result = sanitizeLiveArtifactRefreshRenderJson(
      { kind: "link_card", title: "Bad", url: "file:///tmp/secret" },
      { kind: "markdown", markdown: "<script>alert(1)</script>" }
    );

    assert.equal(result.ok, false);
    assert.equal(result.preservedPrevious, false);
    assert.equal(result.renderJson, null);
    assert.match(result.error, /Only http and https URLs are allowed|Invalid url/);
  });
});
