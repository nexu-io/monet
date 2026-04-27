import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectorsPage from "./page";
import type { ConnectorCatalogCard, ConnectorDetail, ConnectorId } from "../../lib/connectors-api";
import type { ControllerStatePayload, MonetClientConfig } from "../../lib/monet-client";

const useControllerStateMock = vi.fn();
const listConnectorsMock = vi.fn();
const getConnectorMock = vi.fn();
const startConnectorConnectionMock = vi.fn();
const disconnectConnectorMock = vi.fn();

vi.mock("../../lib/controller-state", () => ({
  useControllerState: () => useControllerStateMock()
}));

vi.mock("../../components/page-frame", async () => {
  const React = await import("react");

  return {
    PageFrame: ({ children, title, description }: { readonly children: React.ReactNode; readonly title: string; readonly description: string }) => React.createElement("main", null, React.createElement("h1", null, title), React.createElement("p", null, description), children)
  };
});

vi.mock("../../lib/connectors-api", () => ({
  disconnectConnector: (...args: unknown[]) => disconnectConnectorMock(...args),
  getConnector: (...args: unknown[]) => getConnectorMock(...args),
  listConnectors: (...args: unknown[]) => listConnectorsMock(...args),
  startConnectorConnection: (...args: unknown[]) => startConnectorConnectionMock(...args)
}));

const readyControllerState: ControllerStatePayload = {
  state: "ready"
};

const enabledConfig: MonetClientConfig = {
  apiBase: "http://127.0.0.1:42831",
  bearerToken: null,
  source: "default"
};

const connectorCards: ConnectorCatalogCard[] = [
  {
    id: "github",
    displayName: "GitHub",
    description: "Read repositories, issues, and pull requests from GitHub.",
    category: "developer",
    icon: "github",
    featuredTools: ["GITHUB_LIST_REPOSITORIES", "GITHUB_GET_ISSUE"],
    enabledByDefault: true,
    minimumApprovalPolicy: { sideEffect: "read", approval: "never" },
    capabilitySummaries: ["Browse repositories", "Inspect issues"],
    status: "not_connected"
  },
  {
    id: "notion",
    displayName: "Notion",
    description: "Search workspace pages and databases.",
    category: "productivity",
    icon: "notion",
    featuredTools: ["NOTION_SEARCH_PAGES"],
    enabledByDefault: true,
    minimumApprovalPolicy: { sideEffect: "read", approval: "never" },
    capabilitySummaries: ["Find pages", "Read database rows"],
    status: "connected",
    connectedAccountLabel: "docs@example.com"
  },
  {
    id: "google_drive",
    displayName: "Google Drive",
    description: "Find and summarize Drive files.",
    category: "files",
    icon: "google-drive",
    featuredTools: ["GOOGLE_DRIVE_SEARCH_FILES"],
    enabledByDefault: true,
    minimumApprovalPolicy: { sideEffect: "read", approval: "never" },
    capabilitySummaries: ["Search files", "Read metadata"],
    status: "expired",
    connectedAccountLabel: "drive@example.com"
  }
];

function createGithubDetail(status: ConnectorDetail["connection"]["status"] = "connected"): ConnectorDetail {
  const connected = status === "connected" || status === "expired";

  return {
    ...connectorCards[0],
    status,
    connectedAccountLabel: connected ? "octocat@example.com" : undefined,
    providerConnectorId: "composio-github",
    connection: {
      status,
      connected,
      connectedAccountLabel: connected ? "octocat@example.com" : undefined,
      account: connected
        ? {
            accountLabel: "octocat@example.com",
            providerConnectionId: "conn_github_123",
            providerConnectorId: "composio-github"
          }
        : undefined
    },
    allowedTools: [
      {
        providerToolId: "GITHUB_LIST_REPOSITORIES",
        displayName: "List repositories",
        summary: "List repositories available to the connected account.",
        policy: { sideEffect: "read", approval: "never" }
      },
      {
        providerToolId: "GITHUB_CREATE_ISSUE",
        displayName: "Create issue",
        summary: "Create an issue in a repository.",
        policy: { sideEffect: "write", approval: "always" }
      }
    ],
    lastProviderExecutionId: "exec_123"
  } as ConnectorDetail & { readonly lastProviderExecutionId: string };
}

function setControllerState(config: MonetClientConfig = enabledConfig) {
  useControllerStateMock.mockReturnValue({
    config,
    controllerState: readyControllerState,
    isDesktop: false,
    restartController: vi.fn(),
    restartPending: false
  });
}

function renderConnectorsPage(initialEntry = "/connectors") {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ConnectorsPage />
    </MemoryRouter>
  );
}

describe("ConnectorsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setControllerState();
    listConnectorsMock.mockResolvedValue({ connectors: connectorCards });
    getConnectorMock.mockResolvedValue({ connector: createGithubDetail() });
    startConnectorConnectionMock.mockResolvedValue({ connectorId: "github", status: "connected" });
    disconnectConnectorMock.mockResolvedValue({ connectorId: "github", status: "not_connected" });
    Object.defineProperty(window, "monetDesktop", {
      configurable: true,
      value: {
        openExternalUrl: vi.fn(async () => ({ opened: true }))
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders connector cards with status icons and connect/reconnect/manage states", async () => {
    renderConnectorsPage();

    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notion" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Google Drive" })).toBeInTheDocument();

    expect(screen.getByLabelText("Not connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs reconnect")).toBeInTheDocument();
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
    expect(screen.queryByText("Browse repositories")).not.toBeInTheDocument();
    expect(screen.queryByText("List Repositories")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Manage Notion" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reconnect Google Drive" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "View GitHub tools" })).toBeEnabled();
    expect(screen.getAllByText("Connected as")).toHaveLength(2);
    expect(screen.getByText("docs@example.com")).toBeInTheDocument();
    expect(listConnectorsMock).toHaveBeenCalledTimes(1);
  });

  it("links to connector settings when provider configuration is missing", async () => {
    listConnectorsMock.mockResolvedValue({
      connectors: connectorCards.map((connector) => ({
        ...connector,
        status: "unavailable" as const,
        connectedAccountLabel: undefined
      }))
    });

    renderConnectorsPage();

    expect(await screen.findByRole("heading", { name: "Connector providers are currently unavailable." })).toBeInTheDocument();
    expect(screen.getByText(/Add your Composio API key/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure connectors" })).toHaveAttribute("href", "/settings/connectors");
  });

  it("starts a connector authorization flow and opens provider redirects safely", async () => {
    const user = userEvent.setup();
    const openExternalUrl = vi.fn(async () => ({ opened: true }));
    Object.defineProperty(window, "monetDesktop", {
      configurable: true,
      value: { openExternalUrl }
    });
    startConnectorConnectionMock.mockResolvedValue({
      connectorId: "github" satisfies ConnectorId,
      redirectUrl: "https://auth.example.test/github",
      status: "redirect_required"
    });

    renderConnectorsPage();
    await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));

    await waitFor(() => {
      expect(startConnectorConnectionMock).toHaveBeenCalledWith("github");
    });
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://auth.example.test/github" });
    expect(await screen.findByText(/GitHub authorization opened in your browser/i)).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "GitHub" })).toBeInTheDocument();
  });

  it("shows drawer details and confirms disconnect before revoking the connection", async () => {
    const user = userEvent.setup();
    getConnectorMock
      .mockResolvedValueOnce({ connector: createGithubDetail("connected") })
      .mockResolvedValueOnce({ connector: createGithubDetail("not_connected") });

    renderConnectorsPage("/connectors?connector=github");

    const dialog = await screen.findByRole("dialog", { name: "GitHub" });
    expect(within(dialog).getByText("Connected account: octocat@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Provider connector ID")).toBeInTheDocument();
    expect(within(dialog).getByText("composio-github")).toBeInTheDocument();
    expect(within(dialog).getByText("Provider execution ID")).toBeInTheDocument();
    expect(within(dialog).getByText("exec_123")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Available allowlisted tools" })).toBeInTheDocument();
    expect(within(dialog).getByText("List repositories")).toBeInTheDocument();
    expect(within(dialog).getByText("read · never")).toBeInTheDocument();
    expect(within(dialog).getByText("Create issue")).toBeInTheDocument();
    expect(within(dialog).getByText("write · always")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Disconnect GitHub" }));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "Disconnect GitHub?" });
    expect(within(confirmDialog).getByText(/cancel any pending connector approvals for octocat@example.com/i)).toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole("button", { name: "Disconnect connector" }));

    await waitFor(() => {
      expect(disconnectConnectorMock).toHaveBeenCalledWith("github");
    });
    expect(await screen.findByText("GitHub has been disconnected.")).toBeInTheDocument();
    expect(getConnectorMock).toHaveBeenCalledTimes(2);
  });
});
