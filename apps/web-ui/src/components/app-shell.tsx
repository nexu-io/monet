"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, Card, NavItem, StatusDot } from "@nexu-design/ui-web";

import { useControllerState } from "../lib/controller-state";
import { getSettingsHref, isSettingsPanelId, type SettingsPanelId } from "./settings-panel-content";
import { SettingsSheet } from "./settings-sheet";
import { useSessions } from "./session-provider";

type NavigationItem = {
  href: string;
  label: string;
  description: string;
  settingsPanel?: SettingsPanelId;
};

const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Chat",
    description: "Primary agent conversation surface."
  },
  {
    href: "/settings/models",
    label: "Model Settings",
    description: "Provider and model configuration.",
    settingsPanel: "models"
  },
  {
    href: "/settings/general",
    label: "General Settings",
    description: "Desktop runtime and connectivity preferences.",
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

  return `Updated ${value}`;
}

export function AppShell({
  children,
  pathname,
  header,
  composer
}: {
  children: ReactNode;
  pathname: string;
  header?: ReactNode;
  composer?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { archiveSession, buildSessionHref, createSession, currentSessionId, isSessionsLoading, openSession, providerReadiness, renameSession, sessions } = useSessions();
  const recentSessions = sessions.filter((session) => session.archivedAt === null).slice(0, 6);
  const requestedPanel = searchParams.get("settings");
  const activeSettingsPanel = isSettingsPanelId(requestedPanel) ? requestedPanel : null;
  const isProviderReadinessLoading = providerReadiness.loading;
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const { controllerState, isDesktop } = useControllerState();
  const controllerBadge = controllerState?.state === "ready"
    ? { variant: "success" as const, status: "success" as const, label: "Ready" }
    : controllerState?.state === "starting"
      ? { variant: "warning" as const, status: "warning" as const, label: "Starting" }
      : controllerState?.state === "restarting"
        ? { variant: "warning" as const, status: "warning" as const, label: "Restarting" }
        : controllerState?.state === "failed" || controllerState?.state === "stopped"
          ? { variant: "destructive" as const, status: "error" as const, label: "Attention" }
          : { variant: "secondary" as const, status: "info" as const, label: isDesktop ? "Waiting" : "External" };

  async function handleCreateSession() {
    if (providerSetupRequired) {
      router.push(getSettingsHref(pathname, searchParams, "models"));
      return;
    }

    await createSession({ pathname: "/" });
  }

  async function handleRenameSession(sessionId: string, currentTitle: string) {
    const nextTitle = window.prompt("Rename session", currentTitle)?.trim();

    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    await renameSession(sessionId, nextTitle);
  }

  async function handleArchiveSession(sessionId: string, title: string) {
    if (!window.confirm(`Archive \"${title}\"?`)) {
      return;
    }

    await archiveSession(sessionId);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Card variant="muted" className="card brand-card">
            <div className="brand">
              <Badge variant="accent" size="sm" radius="full" className="brand-badge">
                Local-first agent runtime
              </Badge>
              <h1>Monet</h1>
              <p>Desktop-first chat workspace for sessions, tools, approvals, and local controller status.</p>
            </div>
          </Card>

          <Button
            type="button"
            variant="primary"
            className="new-session-button"
            onClick={() => void handleCreateSession()}
            disabled={isProviderReadinessLoading}
          >
            {isProviderReadinessLoading ? "Checking setup..." : providerSetupRequired ? "Open model settings" : "+ New session"}
          </Button>

          <nav className="nav" aria-label="Primary">
            {navigationItems.map((item) => {
              const href = item.settingsPanel ? getSettingsHref(pathname, searchParams, item.settingsPanel) : item.href;
              const isActive = item.settingsPanel ? activeSettingsPanel === item.settingsPanel : pathname === item.href && activeSettingsPanel === null;

              return (
                <NavItem key={item.href} asChild selected={isActive} className="nav-link">
                  <Link href={href}>
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-description">{item.description}</span>
                  </Link>
                </NavItem>
              );
            })}
          </nav>

          <section className="sidebar-section" aria-labelledby="recent-sessions-heading">
            <div className="sidebar-section-header">
              <span className="eyebrow" id="recent-sessions-heading">Recent sessions</span>
              <Link href="/sessions" className="sidebar-section-link">
                View all
              </Link>
            </div>

            <div className="session-preview-list">
              {isSessionsLoading ? <p className="muted">Loading sessions...</p> : null}
              {!isSessionsLoading && recentSessions.length === 0 ? (
                <p className="muted">{providerSetupRequired ? "Finish provider setup to create the first chat." : "No active sessions yet."}</p>
              ) : null}
              {recentSessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <article
                    key={session.id}
                    className="session-preview"
                    data-active={isActive ? "true" : "false"}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <button type="button" className="session-preview-trigger" onClick={() => openSession(session.id, "/") }>
                      <strong>{session.title}</strong>
                      <span>{formatSessionPreview(session.updatedAt)}</span>
                    </button>
                    <div className="session-preview-actions">
                      <Link href={buildSessionHref("/sessions", session.id)} className="session-preview-link">
                        Details
                      </Link>
                      <button type="button" className="session-preview-link" onClick={() => void handleRenameSession(session.id, session.title)}>
                        Rename
                      </button>
                      <button type="button" className="session-preview-link" onClick={() => void handleArchiveSession(session.id, session.title)}>
                        Archive
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <div className="sidebar-bottom">
          <Card variant="muted" className="card card-muted stack-tight sidebar-status-card">
            <div className="sidebar-section-header">
              <span className="eyebrow">Controller</span>
              <Badge variant={controllerBadge.variant} size="sm" radius="full" className="status-inline">
                <StatusDot status={controllerBadge.status} size="xs" pulse={controllerState?.state === "starting" || controllerState?.state === "restarting"} />
                {controllerBadge.label}
              </Badge>
            </div>
            <p className="muted">{controllerState?.message ?? (isDesktop ? "Controller health and restart feedback stay visible in the sidebar." : "Health and restart actions are available when running inside the desktop shell.")}</p>
          </Card>

          <nav className="nav nav-compact" aria-label="Settings">
            {navigationItems.slice(1).map((item) => {
              const href = item.settingsPanel ? getSettingsHref(pathname, searchParams, item.settingsPanel) : item.href;
              const isActive = item.settingsPanel ? activeSettingsPanel === item.settingsPanel : pathname === item.href && activeSettingsPanel === null;

              return (
                <NavItem key={item.href} asChild selected={isActive} className="nav-link nav-link-compact">
                  <Link href={href}>
                    <span className="nav-label">{item.label}</span>
                    <span className="nav-description">{item.description}</span>
                  </Link>
                </NavItem>
              );
            })}
          </nav>
        </div>
      </aside>

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
