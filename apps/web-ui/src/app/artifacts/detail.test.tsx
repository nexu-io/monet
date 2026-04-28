import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtifactDetailPage from "./detail";
import type { LiveArtifact, LiveArtifactSourceState, LiveArtifactTile } from "../../lib/live-artifacts-api";

const getLiveArtifactMock = vi.fn();
const pinLiveArtifactMock = vi.fn();
const refreshLiveArtifactMock = vi.fn();

vi.mock("../../components/page-frame", async () => {
  const React = await import("react");

  return {
    PageFrame: ({ children, header, title, description }: { readonly children: React.ReactNode; readonly header?: React.ReactNode; readonly title: string; readonly description: string }) => React.createElement("main", null, header ?? React.createElement("header", null, React.createElement("h1", null, title), React.createElement("p", null, description)), children)
  };
});

vi.mock("../../components/session-provider", () => ({
  useSessions: () => ({
    buildSessionHref: (_pathname: string, sessionId: string) => `/sessions/${sessionId}`,
    isSessionsLoading: false,
    sessions: [{ id: "session-1", archivedAt: null }]
  })
}));

vi.mock("../../lib/live-artifacts-api", () => ({
  getLiveArtifact: (...args: unknown[]) => getLiveArtifactMock(...args),
  pinLiveArtifact: (...args: unknown[]) => pinLiveArtifactMock(...args),
  refreshLiveArtifact: (...args: unknown[]) => refreshLiveArtifactMock(...args)
}));

function tile(overrides: Partial<LiveArtifactTile> & Pick<LiveArtifactTile, "id" | "title" | "renderJson">): LiveArtifactTile {
  const { id, title, renderJson, ...rest } = overrides;

  return {
    id,
    artifactId: "artifact-1",
    title,
    position: 0,
    renderJson,
    sourceJson: null,
    lastRefreshedAt: null,
    refreshStatus: "idle",
    refreshStartedAt: null,
    lastError: null,
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z",
    ...rest
  } as LiveArtifactTile;
}

function sourceState(overrides: Pick<LiveArtifactSourceState, "tileId" | "tileTitle" | "state" | "message"> & Partial<LiveArtifactSourceState>): LiveArtifactSourceState {
  return {
    sourceType: "connector_tool",
    toolName: "List records",
    connectorId: "github",
    connectorName: "GitHub",
    accountLabel: "octocat@example.com",
    providerToolId: "GITHUB_LIST_RECORDS",
    ...overrides
  };
}

function artifact(overrides: Partial<LiveArtifact> = {}): LiveArtifact {
  return {
    id: "artifact-1",
    schemaVersion: 1,
    slug: "daily-operations-brief",
    title: "Daily operations brief",
    description: "Refreshable status dashboard",
    status: "active",
    pinned: false,
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z",
    archivedAt: null,
    lastRefreshedAt: "2026-04-27T10:00:00.000Z",
    refreshStatus: "idle",
    refreshStartedAt: null,
    lastRefreshError: null,
    sessionId: "session-1",
    createdByRunId: "run-1",
    createdByToolCallId: "tool-call-1",
    provenanceJson: { createdFrom: "chat" },
    sourceStates: [],
    tiles: [
      tile({ id: "markdown", title: "Summary", renderJson: { kind: "markdown", markdown: "## Wins\n- Shipped artifacts" } }),
      tile({ id: "metric", title: "Open PRs", renderJson: { kind: "metric", label: "PRs", value: "7", trend: "flat" } }),
      tile({ id: "table", title: "Builds", renderJson: { kind: "table", columns: ["Job", "Result"], rows: [["web-ui", "passed"]] } })
    ],
    ...overrides
  } as LiveArtifact;
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={["/artifacts/artifact-1"]}>
      <Routes>
        <Route path="/artifacts/:artifactId" element={<ArtifactDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ArtifactDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLiveArtifactMock.mockResolvedValue({ artifact: artifact() });
    pinLiveArtifactMock.mockResolvedValue({ artifact: artifact({ pinned: true }) });
    refreshLiveArtifactMock.mockResolvedValue({ artifact: artifact({ lastRefreshedAt: "2026-04-27T11:00:00.000Z" }), failures: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders detail header, tiles, source badges, and creating chat action", async () => {
    getLiveArtifactMock.mockResolvedValue({
      artifact: artifact({
        tiles: [
          tile({
            id: "source",
            title: "GitHub Issues",
            renderJson: { kind: "list", items: [{ title: "Bug 123", subtitle: "needs triage", url: "https://example.com/bug" }] },
            sourceJson: {
              type: "connector_tool",
              toolName: "List issues",
              connector: { connectorId: "github", connectorName: "GitHub", accountLabel: "octocat@example.com", providerToolId: "GITHUB_LIST_ISSUES" },
              refreshPermission: "manual_refresh_granted_for_read_only",
              outputMapping: { preferredKind: "list" },
              input: { repo: "monet" }
            }
          })
        ]
      })
    });

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Daily operations brief", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Refreshable status dashboard")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent?.startsWith("Refreshed ") ?? false)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GitHub Issues" })).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Source: GitHub (octocat@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Refresh permitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bug 123" })).toHaveAttribute("href", "https://example.com/bug");
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open creating chat" })).toHaveAttribute("href", "/sessions/session-1");
  });

  it("renders disconnected, expired, missing connector, and stale provider source states", async () => {
    getLiveArtifactMock.mockResolvedValue({
      artifact: artifact({
        sourceStates: [
          sourceState({ tileId: "a", tileTitle: "Mail", state: "disconnected", message: "Reconnect mail." }),
          sourceState({ tileId: "b", tileTitle: "Calendar", state: "expired", message: "OAuth expired." }),
          sourceState({ tileId: "c", tileTitle: "Docs", state: "missing_connector", message: "Connector missing." }),
          sourceState({ tileId: "d", tileTitle: "Issues", state: "stale_provider_tool", message: "Tool ID changed." })
        ]
      })
    });

    renderDetail();

    expect(await screen.findByText("4 connector sources need attention.")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Mail: Disconnected — Reconnect mail.")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Calendar: Expired — OAuth expired.")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Docs: Missing connector — Connector missing.")).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === "Issues: Stale provider tool — Tool ID changed.")).toBeInTheDocument();
  });

  it("shows refresh loading and partial failure errors", async () => {
    const user = userEvent.setup();
    let resolveRefresh: (value: unknown) => void = () => undefined;
    refreshLiveArtifactMock.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    renderDetail();

    await screen.findByRole("heading", { name: "Daily operations brief", level: 1 });
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Refreshing..." })).toBeDisabled();
    resolveRefresh({ artifact: artifact(), failures: [{ tileId: "markdown", tileTitle: "Summary", toolName: "GitHub", error: "Rate limited" }] });

    await waitFor(() => expect(screen.getByText("Failed to refresh 1 tile(s).")).toBeInTheDocument());
  });

  it("shows disabled refresh errors", async () => {
    const user = userEvent.setup();
    refreshLiveArtifactMock.mockRejectedValue({ disabled: true, status: 501, message: "Disabled" });

    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Automatic refresh is not supported or currently disabled for this artifact.")).toBeInTheDocument();
  });

  it("preserves safe rendering for unsafe payloads in detail tiles", async () => {
    getLiveArtifactMock.mockResolvedValue({ artifact: artifact({ tiles: [tile({ id: "unsafe", title: "Unsafe markdown", renderJson: { kind: "markdown", markdown: "<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))" } })] }) });

    renderDetail();

    await screen.findByRole("heading", { name: "Unsafe markdown" });
    expect(screen.getAllByText((_content, element) => element?.textContent?.includes("<img src=x onerror=alert(1)>") ?? false).length).toBeGreaterThan(0);
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
  });
});
