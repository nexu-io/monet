"use client";

import type { ReactNode } from "react";

import { SessionProvider } from "../components/session-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
