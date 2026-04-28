// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveArtifactSidePanel } from "./page";
import type { LiveArtifact } from "../lib/live-artifacts-api";

const getLiveArtifactMock = vi.fn();
const refreshLiveArtifactMock = vi.fn();

vi.mock("@ai-sdk/react", () => ({ useChat: vi.fn() }));
vi.mock("ai", () => ({ DefaultChatTransport: class {}, lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn() }));
vi.mock("lucide-react", async () => {
  const React = await import("react");
  const Icon = ({ className }: { readonly className?: string }) => React.createElement("svg", { className });
  return { ExternalLink: Icon, RefreshCw: Icon, X: Icon };
});
vi.mock("../components/chat-thread", () => ({ ChatThread: () => null }));
vi.mock("../components/composer", () => ({ Composer: () => null }));
vi.mock("../components/live-artifacts/artifact-html-frame", async () => {
  const React = await import("react");
  return {
    ArtifactHtmlFrame: ({ title }: { readonly title: string }) => React.createElement("section", { "aria-label": "Artifact document" }, title)
  };
});
vi.mock("../components/page-frame", () => ({ PageFrame: ({ children }: { readonly children: unknown }) => children }));
vi.mock("../components/session-provider", () => ({ DEFAULT_SESSION_TITLE: "New session", useSessions: vi.fn() }));
vi.mock("../components/workspace-copy", () => ({ sanitizeInternalRuntimeMessage: vi.fn() }));
vi.mock("../lib/controller-state", () => ({ useControllerState: vi.fn() }));
vi.mock("../lib/chat-prompt-seed", () => ({ PENDING_CHAT_PROMPT_STORAGE_KEY: "key", stashPendingChatPrompt: vi.fn() }));
vi.mock("../lib/monet-client", () => ({ getMonetClientConfig: vi.fn() }));
vi.mock("../lib/live-artifacts-api", () => ({
  getLiveArtifact: (...args: unknown[]) => getLiveArtifactMock(...args),
  refreshLiveArtifact: (...args: unknown[]) => refreshLiveArtifactMock(...args)
}));
vi.mock("../lib/provider-readiness", () => ({ fetchProviderTargets: vi.fn() }));
vi.mock("@nexu-design/ui-web", async () => {
  const React = await import("react");
  return {
    Button: ({ children, ...props }: Record<string, unknown>) => React.createElement("button", props, children)
  };
});

function artifact(overrides: Partial<LiveArtifact> = {}): LiveArtifact {
  return {
    id: "artifact-1",
    schemaVersion: 1,
    slug: "artifact-1",
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
    createdByToolCallId: "tool-1",
    provenanceJson: { createdFrom: "chat" },
    contentType: "html_page_v1",
    document: { format: "html_template_v1", sanitizedHtml: "<p>Hello</p>", sourceJson: { refreshPermission: "manual_refresh_granted_for_read_only" } },
    sourceStates: [],
    tiles: [],
    ...overrides
  } as LiveArtifact;
}

describe("LiveArtifactSidePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLiveArtifactMock.mockResolvedValue({ artifact: artifact() });
    refreshLiveArtifactMock.mockResolvedValue({ artifact: artifact({ title: "Refreshed artifact" }), failures: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads initially with getLiveArtifact and refreshes with refreshLiveArtifact", async () => {
    const user = userEvent.setup();
    let resolveRefresh: (value: unknown) => void = () => undefined;
    refreshLiveArtifactMock.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    render(<LiveArtifactSidePanel artifactId="artifact-1" onClose={() => undefined} />);

    expect(await screen.findByRole("heading", { name: "Daily operations brief" })).toBeInTheDocument();
    expect(getLiveArtifactMock).toHaveBeenCalledWith("artifact-1");

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(refreshLiveArtifactMock).toHaveBeenCalledWith("artifact-1");
    expect(screen.getByRole("button", { name: "Refreshing..." })).toBeDisabled();

    resolveRefresh({ artifact: artifact({ title: "Refreshed artifact" }), failures: [] });

    await screen.findByRole("heading", { name: "Refreshed artifact" });
  });

  it("shows the disabled refresh message for 501-style errors", async () => {
    const user = userEvent.setup();
    refreshLiveArtifactMock.mockRejectedValue({ disabled: true, status: 501, message: "Disabled" });

    render(<LiveArtifactSidePanel artifactId="artifact-1" onClose={() => undefined} />);

    await user.click(await screen.findByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("Automatic refresh is not supported or currently disabled for this artifact.")).toBeInTheDocument());
  });
});
