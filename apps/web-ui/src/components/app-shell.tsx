"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Card, NavItem } from "@nexu-design/ui-web";

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
    href: "/sessions",
    label: "Sessions",
    description: "Conversation history and archive entry points."
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

export function AppShell({ children, pathname }: { children: ReactNode; pathname: string }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Card variant="muted" className="card brand-card">
          <div className="brand">
            <Badge variant="accent" size="sm" radius="full" className="brand-badge">
              Local-first agent runtime
            </Badge>
            <h1>Monet</h1>
            <p>Next.js App Router shell for the desktop renderer and local Hono controller.</p>
          </div>
        </Card>

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
      </aside>

      <main className="content">
        <div className="content-inner">{children}</div>
      </main>
    </div>
  );
}
