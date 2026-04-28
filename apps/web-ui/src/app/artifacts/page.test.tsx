import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtifactsPage from "./page";
import { LIVE_ARTIFACT_DISCOVERY_PROMPT, PENDING_CHAT_PROMPT_STORAGE_KEY } from "../../lib/chat-prompt-seed";
import type { LiveArtifactSourceState, LiveArtifactSummary } from "../../lib/live-artifacts-api";

const listLiveArtifactsMock = vi.fn();
const createSessionMock = vi.fn();

vi.mock("../../components/page-frame", async () => {
  const React = await import("react");

  return {
    PageFrame: ({ children, header, title, description }: { readonly children: React.ReactNode; readonly header?: React.ReactNode; readonly title: string; readonly description: string }) => React.createElement("main", null, header ?? React.createElement("header", null, React.createElement("h1", null, title), React.createElement("p", null, description)), children)
  };
});

vi.mock("../../components/session-provider", () => ({
  useSessions: () => ({ createSession: createSessionMock })
}));

vi.mock("../../lib/live-artifacts-api", () => ({
  listLiveArtifacts: (...args: unknown[]) => listLiveArtifactsMock(...args)
}));

function summary(overrides: Partial<LiveArtifactSummary> & Pick<LiveArtifactSummary, "id" | "title">): LiveArtifactSummary {
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    schemaVersion: 1,
    slug: id,
    description: null,
    status: "active",
    pinned: false,
    createdAt: "2026-04-25T10:00:00.000Z",
    updatedAt: "2026-04-25T10:00:00.000Z",
    archivedAt: null,
    lastRefreshedAt: null,
    refreshStatus: "idle",
    refreshStartedAt: null,
    lastRefreshError: null,
    sessionId: null,
    tileCount: 1,
    sourceStates: [],
    ...rest
  } as LiveArtifactSummary;
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

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/artifacts"]}>
      <ArtifactsPage />
    </MemoryRouter>
  );
}

describe("ArtifactsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    createSessionMock.mockResolvedValue({ id: "session-1" });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the empty state with connector guidance", async () => {
    listLiveArtifactsMock.mockResolvedValue({ artifacts: [] });

    renderPage();

    expect(await screen.findByRole("heading", { name: "No live artifacts yet." })).toBeInTheDocument();
    expect(screen.getByText(/Connector setup lives on the Connectors page/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Browse connectors" })[0]).toHaveAttribute("href", "/connectors");
    expect(listLiveArtifactsMock).toHaveBeenCalledWith({ includeArchived: false });
  });

  it("renders populated artifacts pinned first with connector states", async () => {
    listLiveArtifactsMock.mockResolvedValue({
      artifacts: [
        summary({ id: "regular", title: "Regular report", updatedAt: "2026-04-27T10:00:00.000Z" }),
        summary({
          id: "pinned",
          title: "Pinned daily brief",
          description: "Morning source summary",
          pinned: true,
          updatedAt: "2026-04-26T10:00:00.000Z",
          sourceStates: [
            sourceState({ tileId: "tile-1", tileTitle: "Inbox", state: "disconnected", message: "Reconnect Gmail." }),
            sourceState({ tileId: "tile-2", tileTitle: "Calendar", state: "expired", message: "Calendar authorization expired." })
          ]
        }),
        summary({ id: "stale", title: "Stale source report", sourceStates: [sourceState({ tileId: "tile-3", tileTitle: "Issues", state: "stale_provider_tool", message: "Tool changed." })] })
      ]
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "Pinned daily brief" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Pinned daily brief", "Regular report", "Stale source report"]);
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Morning source summary")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Stale tool")).toBeInTheDocument();
    expect(screen.getByText(/Reconnect Gmail/i)).toBeInTheDocument();
  });

  it("seeds the new artifact discovery prompt before starting chat", async () => {
    const user = userEvent.setup();
    listLiveArtifactsMock.mockResolvedValue({ artifacts: [] });

    renderPage();

    const emptyState = await screen.findByRole("heading", { name: "No live artifacts yet." });
    await user.click(within(emptyState.closest("section") as HTMLElement).getByRole("button", { name: "Start a chat to create a new live artifact" }));

    expect(window.sessionStorage.getItem(PENDING_CHAT_PROMPT_STORAGE_KEY)).toBe(LIVE_ARTIFACT_DISCOVERY_PROMPT);
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith({ pathname: "/" }));
  });
});
