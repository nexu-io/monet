import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MonetClientConfig } from "../lib/monet-client";
import { AppShell } from "./app-shell";

const useControllerStateMock = vi.fn();

vi.mock("../lib/controller-state", () => ({
  useControllerState: () => useControllerStateMock()
}));

vi.mock("@nexu-design/ui-web", async () => {
  const React = await import("react");
  const passthrough = (tagName: keyof React.JSX.IntrinsicElements) => ({ children, ...props }: { readonly children?: React.ReactNode }) => React.createElement(tagName, props, children);

  return {
    Button: passthrough("button"),
    NavigationMenu: passthrough("nav"),
    NavigationMenuButton: ({ active, asChild, children, ...props }: { readonly active?: boolean; readonly asChild?: boolean; readonly children?: React.ReactNode }) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, { ...props, "data-active": active ? "true" : "false" } as Record<string, unknown>);
      }

      return React.createElement("button", { ...props, "data-active": active ? "true" : "false" }, children);
    },
    NavigationMenuItem: passthrough("li"),
    NavigationMenuLabel: passthrough("span"),
    NavigationMenuList: passthrough("ul"),
    PageHeader: ({ title, description, ...props }: { readonly title: string; readonly description: string }) => React.createElement("header", props, React.createElement("h1", null, title), React.createElement("p", null, description)),
    Sidebar: passthrough("aside"),
    SidebarContent: passthrough("div"),
    SidebarFooter: passthrough("footer"),
    SidebarHeader: passthrough("header")
  };
});

vi.mock("./session-provider", () => ({
  useSessions: () => ({
    createSession: vi.fn(async () => ({ id: "session-1" })),
    currentSessionId: null,
    isSessionsLoading: false,
    openSession: vi.fn(),
    sessions: []
  })
}));

function createConfig(connectors: boolean): MonetClientConfig {
  return {
    apiBase: "http://127.0.0.1:42831",
    bearerToken: null,
    features: { connectors },
    source: "default"
  };
}

function renderShell({ connectorsEnabled, pathname = "/" }: { readonly connectorsEnabled: boolean; readonly pathname?: string }) {
  useControllerStateMock.mockReturnValue({
    config: createConfig(connectorsEnabled),
    isDesktop: false
  });

  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell pathname={pathname}>Workspace</AppShell>
    </MemoryRouter>
  );
}

describe("AppShell connector navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows connector sidebar navigation when the feature flag is enabled", () => {
    renderShell({ connectorsEnabled: true, pathname: "/connectors" });

    const connectorsLink = screen.getByRole("link", { name: /connectors/i });
    expect(connectorsLink).toBeInTheDocument();
    expect(connectorsLink).toHaveAttribute("href", "/connectors");
  });

  it("keeps connector sidebar navigation hidden when the feature flag is disabled", () => {
    renderShell({ connectorsEnabled: false, pathname: "/connectors" });

    expect(screen.queryByRole("link", { name: /connectors/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument();
  });
});
