"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@nexu-design/ui-web";

import { AppShell } from "../../components/app-shell";
import { settingsPanels } from "../../components/settings-panel-content";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const activePanel = pathname.includes("/settings/models") ? "models" : "general";

  function handleTabChange(nextValue: string) {
    router.push(`/settings/${nextValue}`);
  }

  return (
    <AppShell pathname={pathname}>
      <div className="settings-page">
        <div className="settings-page-header">
          <span className="eyebrow">Workspace</span>
          <h2>Settings</h2>
          <p className="muted">
            Configure providers, models, and local workspace preferences in one place.
          </p>
        </div>

        <div className="settings-page-body">
          <Tabs value={activePanel} onValueChange={handleTabChange} className="settings-page-tabs">
            <TabsList className="settings-page-tabs-list" aria-label="Settings sections">
              {settingsPanels.map((panel) => (
                <TabsTrigger
                  key={panel.id}
                  value={panel.id}
                  className="settings-page-tab-trigger"
                >
                  {panel.title}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={activePanel} className="settings-page-tab-content">
              {children}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}
