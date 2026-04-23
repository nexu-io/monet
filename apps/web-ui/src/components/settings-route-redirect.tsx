"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getSettingsHref, type SettingsPanelId } from "./settings-panel-content";

export function SettingsRouteRedirect({ panelId }: { panelId: SettingsPanelId }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    router.replace(getSettingsHref("/", searchParams, panelId));
  }, [panelId, router, searchParams]);

  return null;
}
