"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@nexu-design/ui-web";

export const SETTINGS_QUERY_PARAM = "settings";

export const settingsPanels = [
  {
    id: "models",
    title: "Model Settings",
    description: "Provider and model configuration."
  },
  {
    id: "general",
    title: "General Settings",
    description: "Desktop runtime and connectivity preferences."
  }
] as const;

export type SettingsPanelId = (typeof settingsPanels)[number]["id"];

const modelSettings = [
  "OpenAI and OpenRouter provider records will be loaded from the controller.",
  "Model defaults stay in the local database so desktop sessions can resume after restart.",
  "The UI remains client-driven and compatible with static export constraints."
];

const runtimeSettings = [
  {
    title: "Controller endpoint",
    detail: "Resolved from preload in Electron, with public env fallback for browser-only local development."
  },
  {
    title: "Local auth token",
    detail: "Passed as a bearer token so the controller can reject unexpected local requests."
  },
  {
    title: "Desktop health state",
    detail: "A dedicated service-status UI can be layered here once Electron reports controller crash events."
  }
];

export function isSettingsPanelId(value: string | null): value is SettingsPanelId {
  return settingsPanels.some((panel) => panel.id === value);
}

export function getSettingsHref(
  pathname: string,
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
  panelId: SettingsPanelId | null
) {
  const params = new URLSearchParams(searchParams.toString());

  if (panelId) {
    params.set(SETTINGS_QUERY_PARAM, panelId);
  } else {
    params.delete(SETTINGS_QUERY_PARAM);
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function SettingsPanelContent({ panelId }: { panelId: SettingsPanelId }) {
  if (panelId === "models") {
    return (
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Provider configuration</span>
            <CardTitle>Model routing and defaults</CardTitle>
          </div>
        </CardHeader>

        <CardContent>
          <ul className="settings-list">
            {modelSettings.map((item) => (
              <li key={item}>
                <Card variant="muted" padding="sm" className="card card-muted">
                  {item}
                </Card>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card stack">
      <CardHeader>
        <div className="stack-tight">
          <span className="eyebrow">Desktop integration</span>
          <CardTitle>Renderer runtime settings</CardTitle>
        </div>
      </CardHeader>

      <CardContent>
        <ul className="kv-list">
          {runtimeSettings.map((item) => (
            <li key={item.title}>
              <Card variant="muted" padding="sm" className="card card-muted stack-tight">
                <strong>{item.title}</strong>
                <div className="muted">{item.detail}</div>
              </Card>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
