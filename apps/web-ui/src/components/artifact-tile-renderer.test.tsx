import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactTileRenderContent } from "./artifact-tile-renderer";

describe("ArtifactTileRenderContent", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders markdown without interpreting unsafe HTML", () => {
    render(<ArtifactTileRenderContent renderJson={{ kind: "markdown", markdown: "# Daily Brief\n<script>alert('x')</script>\n[Safe](https://example.com) [Unsafe](javascript:alert(1))" }} />);

    expect(screen.getByRole("heading", { name: "Daily Brief" })).toBeInTheDocument();
    expect(screen.getAllByText((_content, element) => element?.textContent?.includes("<script>alert('x')</script>") ?? false).length).toBeGreaterThan(0);
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Safe" })).toHaveAttribute("href", "https://example.com/");
    expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
  });

  it("renders metric tiles", () => {
    render(<ArtifactTileRenderContent renderJson={{ kind: "metric", label: "Open PRs", value: "12", caption: "Across tracked repos", trend: "up" }} />);

    expect(screen.getByText("Open PRs")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Across tracked repos")).toBeInTheDocument();
    expect(screen.getByLabelText("Trending up")).toBeInTheDocument();
  });

  it("renders list tiles and strips unsafe item links", () => {
    render(<ArtifactTileRenderContent renderJson={{ kind: "list", items: [{ title: "Release checklist", subtitle: "Ready", url: "https://example.com/release" }, { title: "Unsafe task", url: "javascript:alert(1)" }] }} />);

    expect(screen.getByRole("link", { name: "Release checklist" })).toHaveAttribute("href", "https://example.com/release");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Unsafe task")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unsafe task" })).not.toBeInTheDocument();
  });

  it("renders table tiles", () => {
    render(<ArtifactTileRenderContent renderJson={{ kind: "table", columns: ["Repo", "Status"], rows: [["monet", "green"], ["connectors", "yellow"]] }} />);

    expect(screen.getByRole("columnheader", { name: "Repo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("monet")).toBeInTheDocument();
    expect(screen.getByText("yellow")).toBeInTheDocument();
  });

  it("renders link cards with safe and unsafe URLs", () => {
    const { rerender } = render(<ArtifactTileRenderContent renderJson={{ kind: "link_card", title: "Roadmap", description: "Planning doc", sourceLabel: "Docs", url: "https://example.com/roadmap" }} />);

    expect(screen.getByRole("link", { name: /Roadmap/i })).toHaveAttribute("href", "https://example.com/roadmap");
    expect(screen.getByText("Planning doc")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();

    rerender(<ArtifactTileRenderContent renderJson={{ kind: "link_card", title: "Unsafe", url: "file:///etc/passwd" }} />);

    expect(screen.getByText("Unsafe")).toBeInTheDocument();
    expect(screen.getByText("Link unavailable: unsupported URL.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Unsafe/i })).not.toBeInTheDocument();
  });

  it("renders json fallback tiles", () => {
    render(<ArtifactTileRenderContent renderJson={{ kind: "json", value: { connector: "github", count: 3 } }} />);

    expect(screen.getByText(/"connector": "github"/)).toBeInTheDocument();
    expect(screen.getByText(/"count": 3/)).toBeInTheDocument();
  });
});
