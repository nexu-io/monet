"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@nexu-design/ui-web";

import { AppShell } from "./app-shell";

export function PageFrame({
  pathname,
  title,
  description,
  header,
  headerActions,
  composer,
  contentClassName,
  contentWrapper,
  onDesktopStopShortcut,
  children
}: {
  pathname: string;
  title: string;
  description: string;
  header?: ReactNode;
  headerActions?: ReactNode;
  composer?: ReactNode;
  contentClassName?: string;
  contentWrapper?: "default" | "none";
  onDesktopStopShortcut?: () => void;
  children: ReactNode;
}) {
  return (
    <AppShell
      pathname={pathname}
      header={header ?? <PageHeader title={title} description={description} actions={headerActions} density="shell" className="[&_h1]:m-0 [&_h1]:font-heading [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-[-0.01em] [&_h1]:text-text-heading [&_p]:m-0 [&_p]:mt-1.5 [&_p]:max-w-[68ch] [&_p]:text-text-secondary" />}
      composer={composer}
      contentClassName={contentClassName}
      contentWrapper={contentWrapper}
      onDesktopStopShortcut={onDesktopStopShortcut}
    >
      {children}
    </AppShell>
  );
}
