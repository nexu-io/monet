"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@nexu-design/ui-web";

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
      <PageHeader title={title} description={description} density="shell" className="page-intro" />
      {children}
    </AppShell>
  );
}
