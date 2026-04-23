import type { ReactNode } from "react";

import { AppShell } from "./app-shell";

export function PageFrame({
  pathname,
  title,
  description,
  children
}: {
  pathname: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <AppShell pathname={pathname}>
      <header className="page-intro">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </AppShell>
  );
}
