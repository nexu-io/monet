import type { ReactNode } from "react";
import Link from "next/link";

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
        <div className="brand">
          <span className="brand-badge">Local-first agent runtime</span>
          <h1>Monet</h1>
          <p>Next.js App Router shell for the desktop renderer and local Hono controller.</p>
        </div>

        <nav className="nav" aria-label="Primary">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link key={item.href} href={item.href} className="nav-link" data-active={isActive}>
                <span className="nav-label">{item.label}</span>
                <span className="nav-description">{item.description}</span>
              </Link>
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
