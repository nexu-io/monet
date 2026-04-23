"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@nexu-design/ui-web";

import { AppShell } from "./app-shell";

export function PageFrame({
  pathname,
  title,
  description,
  header,
  composer,
  children
}: {
  pathname: string;
  title: string;
  description: string;
  header?: ReactNode;
  composer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell
      pathname={pathname}
      header={header ?? <PageHeader title={title} description={description} density="shell" className="page-intro" />}
      composer={composer}
    >
      {children}
    </AppShell>
  );
}
