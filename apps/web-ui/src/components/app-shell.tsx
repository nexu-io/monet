"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  NavigationMenu,
  NavigationMenuButton,
  NavigationMenuItem,
  NavigationMenuLabel,
  NavigationMenuList,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  StatusDot
} from "@nexu-design/ui-web";

import { useControllerState } from "../lib/controller-state";
import { useSessions } from "./session-provider";
import { sanitizeInternalRuntimeMessage } from "./workspace-copy";

type NavigationItem = {
  href: string;
  label: string;
  description?: string;
};

const primaryNavItems: NavigationItem[] = [
  {
    href: "/",
    label: "Chat"
  },
  {
    href: "/sessions",
    label: "Sessions"
  }
];

function formatSessionPreview(updatedAt: string) {
  const value = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(updatedAt));

  return value;
}

export function AppShell({
  children,
  pathname,
  header,
  composer,
  onDesktopStopShortcut
}: {
  children: ReactNode;
  pathname: string;
  header?: ReactNode;
  composer?: ReactNode;
  onDesktopStopShortcut?: () => void;
}) {
  const router = useRouter();
  const {
    createSession,
    currentSessionId,
    isSessionsLoading,
    openSession,
    providerReadiness,
    sessions
  } = useSessions();
  const recentSessions = sessions.filter((session) => session.archivedAt === null).slice(0, 6);
  const isProviderReadinessLoading = providerReadiness.loading;
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const { controllerState, isDesktop } = useControllerState();
  const desktopPlatform = typeof window === "undefined" ? undefined : window.monetDesktop?.platform;
  const runtimeLifecycle = controllerState?.state;
  const runtimeLabel = runtimeLifecycle === "ready"
    ? "Runtime ready"
    : runtimeLifecycle === "starting"
      ? "Starting runtime"
      : runtimeLifecycle === "restarting"
        ? "Restarting runtime"
        : runtimeLifecycle === "failed"
          ? "Runtime unavailable"
          : runtimeLifecycle === "stopped"
            ? "Runtime stopped"
            : isDesktop
              ? "Preparing runtime"
              : "Browser mode";
  const runtimeStatus: "success" | "warning" | "error" | "neutral" = runtimeLifecycle === "ready"
    ? "success"
    : runtimeLifecycle === "starting" || runtimeLifecycle === "restarting"
      ? "warning"
      : runtimeLifecycle === "failed" || runtimeLifecycle === "stopped"
        ? "error"
        : "neutral";
  const runtimeHint = sanitizeInternalRuntimeMessage(controllerState?.message) ?? (isDesktop ? "Local workspace" : "Browser workspace");
  const isSettingsOpen = pathname.startsWith("/settings");
  const openSettingsHref = "/settings/general";

  async function handleCreateSession() {
    if (providerSetupRequired) {
      router.push("/settings/models");
      return;
    }

    await createSession({ pathname: "/" });
  }

  useEffect(() => {
    const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;

    if (!desktopApi?.onShortcut) {
      return;
    }

    return desktopApi.onShortcut(({ action }) => {
      if (action === "new-session") {
        void handleCreateSession();
        return;
      }

      if (action === "open-settings") {
        router.push("/settings/general");
      }
    });
  }, [onDesktopStopShortcut, pathname, router]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      const isStopShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ".";

      if (isStopShortcut) {
        event.preventDefault();
        onDesktopStopShortcut?.();
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      if (pathname.startsWith("/settings")) {
        router.push("/");
        return;
      }

      onDesktopStopShortcut?.();

      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement) || activeElement === document.body) {
        return;
      }

      activeElement.blur();
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDesktop, onDesktopStopShortcut, pathname, router]);

  function isNavItemActive(item: NavigationItem) {
    return pathname === item.href && !pathname.startsWith("/settings");
  }

  return (
    <div className="shell" data-desktop-shell={isDesktop ? "true" : "false"} data-desktop-platform={desktopPlatform}>
      <Sidebar className="sidebar">
        {isDesktop ? <div className="sidebar-drag-region" aria-hidden="true" /> : null}

        <SidebarHeader className="sidebar-top">
          <div className="sidebar-brand">
            <span className="sidebar-brand-mark" aria-hidden="true">M</span>
            <div className="stack-tight">
              <span className="sidebar-brand-name">Monet</span>
              <span className="sidebar-brand-tag">Your local AI workspace</span>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            size="md"
            className="sidebar-cta"
            onClick={() => void handleCreateSession()}
            disabled={isProviderReadinessLoading}
          >
            {isProviderReadinessLoading
              ? "Checking setup…"
              : providerSetupRequired
                ? "Finish model setup"
                : "+ New chat"}
          </Button>

          <NavigationMenu>
            <NavigationMenuList>
              {primaryNavItems.map((item) => {
                const href = item.href;
                const selected = isNavItemActive(item);

                return (
                  <NavigationMenuItem key={item.href}>
                    <NavigationMenuButton asChild active={selected} className="sidebar-nav-link">
                      <Link href={href}>{item.label}</Link>
                    </NavigationMenuButton>
                  </NavigationMenuItem>
                );
              })}
            </NavigationMenuList>
          </NavigationMenu>

          <section className="sidebar-section" aria-labelledby="recent-sessions-heading">
            <div className="sidebar-section-header">
              <NavigationMenuLabel className="sidebar-section-header-label" id="recent-sessions-heading">
                Recent
              </NavigationMenuLabel>
              <Link href="/sessions" className="sidebar-section-link">
                View all
              </Link>
            </div>

            <div className="sidebar-recent-list">
              {isSessionsLoading && recentSessions.length === 0 ? (
                <p className="sidebar-recent-empty">Loading sessions…</p>
              ) : null}
              {!isSessionsLoading && recentSessions.length === 0 ? (
                <p className="sidebar-recent-empty">
                  {providerSetupRequired ? "Finish provider setup to create the first chat." : "No active chats yet."}
                </p>
              ) : null}
              {recentSessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <button
                    key={session.id}
                    type="button"
                    className="sidebar-recent-item"
                    data-active={isActive ? "true" : "false"}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => openSession(session.id, "/")}
                  >
                    <span className="sidebar-recent-item-title">{session.title}</span>
                    <span className="sidebar-recent-item-meta">{formatSessionPreview(session.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </SidebarHeader>

        <SidebarContent />

        <SidebarFooter className="sidebar-bottom">
          {/*
            Single settings entry point. Tabs for General / Model live on the page.
            Keeping this as a Link (not a button) preserves
            keyboard + right-click semantics and plays nicely with Next's
            prefetch.
          */}
          <NavigationMenu aria-label="Settings">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuButton
                  asChild
                  active={isSettingsOpen}
                  className="sidebar-nav-link sidebar-settings-link"
                >
                  <Link href={openSettingsHref}>
                    <span className="sidebar-settings-link-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="2" />
                        <path d="M13.3 9.4a5.4 5.4 0 0 0 0-2.8l1.3-1-1.5-2.6-1.6.5a5.4 5.4 0 0 0-2.4-1.4L8.8.5H7.2l-.3 1.6a5.4 5.4 0 0 0-2.4 1.4l-1.6-.5-1.5 2.6 1.3 1a5.4 5.4 0 0 0 0 2.8l-1.3 1 1.5 2.6 1.6-.5a5.4 5.4 0 0 0 2.4 1.4l.3 1.6h1.6l.3-1.6a5.4 5.4 0 0 0 2.4-1.4l1.6.5 1.5-2.6-1.3-1z" />
                      </svg>
                    </span>
                    <span>Settings</span>
                  </Link>
                </NavigationMenuButton>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <div className="sidebar-status" role="status" aria-live="polite">
            <StatusDot
              status={runtimeStatus}
              size="sm"
              pulse={runtimeLifecycle === "starting" || runtimeLifecycle === "restarting"}
            />
            <div className="sidebar-status-text">
              <div className="sidebar-status-label">{runtimeLabel}</div>
              <div className="sidebar-status-hint">{runtimeHint}</div>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <main className="main-canvas" data-has-composer={composer ? "true" : "false"}>
        {header ? <div className="canvas-header">{header}</div> : null}
        <div className="canvas-body">
          <div className="canvas-scroll">{children}</div>
        </div>
        {composer ? <div className="canvas-composer">{composer}</div> : null}
      </main>

    </div>
  );
}
