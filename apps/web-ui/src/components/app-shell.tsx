"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Button, Card, NavItem, StatusDot } from "@nexu-design/ui-web";

type NavigationItem = {
  href: string;
  label: string;
  description: string;
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
    description: "Provider and model configuration."
  },
  {
    href: "/settings/general",
    label: "General Settings",
    description: "Desktop runtime and connectivity preferences."
  }
];

const recentSessions = [
  {
    id: "session-current",
    title: "Install and upgrade strategy",
    preview: "App shell iteration and chat scaffolding",
    active: true
  },
  {
    id: "session-tools",
    title: "Tool approval UX",
    preview: "Awaiting inline confirm card work",
    active: false
  },
  {
    id: "session-settings",
    title: "Provider settings",
    preview: "OpenAI and OpenRouter validation flows",
    active: false
  }
];

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

          <Button type="button" variant="primary" className="new-session-button">
            + New session
          </Button>

          <nav className="nav" aria-label="Primary">
            {navigationItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <NavItem key={item.href} asChild selected={isActive} className="nav-link">
                  <Link href={item.href}>
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
              {recentSessions.map((session) => (
                <article
                  key={session.id}
                  className="session-preview"
                  data-active={session.active ? "true" : "false"}
                  aria-current={session.active ? "page" : undefined}
                >
                  <strong>{session.title}</strong>
                  <span>{session.preview}</span>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="sidebar-bottom">
          <Card variant="muted" className="card card-muted stack-tight sidebar-status-card">
            <div className="sidebar-section-header">
              <span className="eyebrow">Controller</span>
              <Badge variant="secondary" size="sm" radius="full" className="status-inline">
                <StatusDot status="success" size="xs" />
                Ready
              </Badge>
            </div>
            <p className="muted">Health, restart, and failure handling will surface here without leaving the chat view.</p>
          </Card>

          <nav className="nav nav-compact" aria-label="Settings">
            {navigationItems.slice(1).map((item) => {
              const isActive = pathname === item.href;

              return (
                <NavItem key={item.href} asChild selected={isActive} className="nav-link nav-link-compact">
                  <Link href={item.href}>
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
    </div>
  );
}
