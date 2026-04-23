"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../../components/page-frame";

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

export default function GeneralSettingsPage() {
  return (
    <PageFrame
      pathname="/settings/general"
      title="General Settings"
      description="Runtime configuration boundaries for the renderer, preload bridge, and local API access."
    >
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
    </PageFrame>
  );
}
