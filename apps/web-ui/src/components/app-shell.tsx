"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { getSettingsHref, isSettingsPanelId, type SettingsPanelId } from "./settings-panel-content";
import { SettingsSheet } from "./settings-sheet";
import { useSessions } from "./session-provider";

type NavigationItem = {
  href: string;
  label: string;
  description?: string;
  settingsPanel?: SettingsPanelId;
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

const settingsNavItems: NavigationItem[] = [
  {
    href: "/settings/models",
    label: "Model settings",
    settingsPanel: "models"
  },
  {
    href: "/settings/general",
    label: "General settings",
    settingsPanel: "general"
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
  const searchParams = useSearchParams();
  const {
    createSession,
    currentSessionId,
    isSessionsLoading,
    openSession,
    providerReadiness,
    sessions
  } = useSessions();
  const recentSessions = sessions.filter((session) => session.archivedAt === null).slice(0, 6);
  const requestedPanel = searchParams.get("settings");
  const activeSettingsPanel = isSettingsPanelId(requestedPanel) ? requestedPanel : null;
  const isProviderReadinessLoading = providerReadiness.loading;
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const { controllerState, isDesktop } = useControllerState();
  const desktopPlatform = typeof window === "undefined" ? undefined : window.monetDesktop?.platform;
  const controllerLifecycle = controllerState?.state;
  const controllerLabel = controllerLifecycle === "ready"
    ? "Controller ready"
    : controllerLifecycle === "starting"
      ? "Starting controller"
      : controllerLifecycle === "restarting"
        ? "Restarting controller"
        : controllerLifecycle === "failed"
          ? "Controller unavailable"
          : controllerLifecycle === "stopped"
            ? "Controller stopped"
            : isDesktop
              ? "Waiting for controller"
              : "External controller";
  const controllerStatus: "success" | "warning" | "error" | "neutral" = controllerLifecycle === "ready"
    ? "success"
    : controllerLifecycle === "starting" || controllerLifecycle === "restarting"
      ? "warning"
      : controllerLifecycle === "failed" || controllerLifecycle === "stopped"
        ? "error"
        : "neutral";

  async function handleCreateSession() {
    if (providerSetupRequired) {
      router.push(getSettingsHref(pathname, searchParams, "models"));
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
        router.push(getSettingsHref(pathname, searchParams, activeSettingsPanel ?? "models"));
      }
    });
  }, [activeSettingsPanel, onDesktopStopShortcut, pathname, router, searchParams]);

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

      if (activeSettingsPanel) {
        router.push(getSettingsHref(pathname, searchParams, null));
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
  }, [activeSettingsPanel, isDesktop, onDesktopStopShortcut, pathname, router, searchParams]);

  function isNavItemActive(item: NavigationItem) {
    if (item.settingsPanel) {
      return activeSettingsPanel === item.settingsPanel;
    }

    return pathname === item.href && activeSettingsPanel === null;
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
              <span className="sidebar-brand-tag">Local agent runtime</span>
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
                const href = item.settingsPanel ? getSettingsHref(pathname, searchParams, item.settingsPanel) : item.href;
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
          <NavigationMenu aria-label="Settings">
            <NavigationMenuList>
              {settingsNavItems.map((item) => {
                const href = item.settingsPanel ? getSettingsHref(pathname, searchParams, item.settingsPanel) : item.href;
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

          <div className="sidebar-status" role="status" aria-live="polite">
            <StatusDot
              status={controllerStatus}
              size="sm"
              pulse={controllerLifecycle === "starting" || controllerLifecycle === "restarting"}
            />
            <div className="sidebar-status-text">
              <div className="sidebar-status-label">{controllerLabel}</div>
              <div className="sidebar-status-hint">
                {controllerState?.message ?? (isDesktop ? "Local controller" : "Browser mode")}
              </div>
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

      <SettingsSheet pathname={pathname} />
    </div>
  );
}
