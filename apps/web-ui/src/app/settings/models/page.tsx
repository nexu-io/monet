"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../../components/page-frame";

const modelSettings = [
  "OpenAI and OpenRouter provider records will be loaded from the controller.",
  "Model defaults stay in the local database so desktop sessions can resume after restart.",
  "The UI remains client-driven and compatible with static export constraints."
];

export default function ModelSettingsPage() {
  return (
    <PageFrame
      pathname="/settings/models"
      title="Model Settings"
      description="Provider and model configuration surfaces for the desktop-first local runtime."
    >
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
    </PageFrame>
  );
}
