"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@nexu-design/ui-web";

import { getSettingsHref, isSettingsPanelId, settingsPanels, SettingsPanelContent } from "./settings-panel-content";

export function SettingsSheet({ pathname }: { pathname: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPanel = searchParams.get("settings");
  const activePanel = isSettingsPanelId(requestedPanel) ? requestedPanel : null;

  useEffect(() => {
    if (!activePanel) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        router.push(getSettingsHref(pathname, searchParams, null));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel, pathname, router, searchParams]);

  if (!activePanel) {
    return null;
  }

  const activeDefinition = settingsPanels.find((panel) => panel.id === activePanel) ?? settingsPanels[0];
  const closeHref = getSettingsHref(pathname, searchParams, null);

  return (
    <div className="settings-sheet-root">
      <button
        type="button"
        className="settings-sheet-backdrop"
        aria-label="Close settings"
        onClick={() => router.push(closeHref)}
      />

      <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-sheet-title">
        <header className="settings-sheet-header">
          <div className="stack-tight">
            <span className="eyebrow">Settings</span>
            <h2 id="settings-sheet-title">{activeDefinition.title}</h2>
            <p className="muted">Stay in context while configuring the local desktop workspace.</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => router.push(closeHref)}>
            Close
          </Button>
        </header>

        <nav className="settings-sheet-nav" aria-label="Settings sections">
          {settingsPanels.map((panel) => {
            const href = getSettingsHref(pathname, searchParams, panel.id);
            const isActive = panel.id === activePanel;

            return (
              <Link key={panel.id} href={href} className="settings-sheet-nav-link" data-active={isActive ? "true" : "false"}>
                <span className="nav-label">{panel.title}</span>
                <span className="nav-description">{panel.description}</span>
              </Link>
            );
          })}
        </nav>

        <div className="settings-sheet-body">
          <SettingsPanelContent panelId={activePanel} />
        </div>
      </section>
    </div>
  );
}
