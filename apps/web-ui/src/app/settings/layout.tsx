"use client";

import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@nexu-design/ui-web";

import { AppShell } from "../../components/app-shell";
import { settingsPanels } from "../../components/settings-panel-content";

export default function SettingsLayout({ children }: { children?: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  
  const activePanel = pathname.includes("/settings/models") ? "models" : "general";

  function handleTabChange(nextValue: string) {
    navigate(`/settings/${nextValue}`);
  }

  return (
    <AppShell pathname={pathname}>
      <div className="flex h-full w-full flex-col gap-0 p-0">
        <div className="flex flex-col gap-1 px-6 pt-5 pb-3 max-app:px-4 max-app:pt-4 max-app:pb-3 max-sm:p-4">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Workspace</span>
          <h2 className="m-0 font-heading text-2xl font-bold tracking-[-0.01em] text-text-heading">Settings</h2>
          <p className="m-0 leading-[1.5] text-text-muted">
            Configure providers, models, and local workspace preferences in one place.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <Tabs value={activePanel} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="inline-flex gap-1 bg-transparent px-6 pt-3 pb-0 max-app:px-4 max-app:pt-2 max-app:pb-0" aria-label="Settings sections">
              {settingsPanels.map((panel) => (
                <TabsTrigger
                  key={panel.id}
                  value={panel.id}
                  className="relative cursor-pointer rounded-t-md border-0 bg-transparent px-3 py-2 text-sm font-medium text-text-secondary transition-[color,background-color] duration-fast ease-standard [font-family:inherit] hover:bg-surface-2 hover:text-text-primary data-[state=active]:text-text-heading data-[state=active]:after:absolute data-[state=active]:after:right-2 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:left-2 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-t-[2px] data-[state=active]:after:bg-accent data-[state=active]:after:content-['']"
                >
                  {panel.title}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={activePanel} className="flex min-h-0 flex-1 flex-col gap-(--app-section-gap) overflow-auto p-0 data-[state=inactive]:hidden">
              {children ?? <Outlet />}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}
