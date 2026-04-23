"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../components/page-frame";

const sessionStates = [
  {
    label: "Recent conversations",
    detail: "Client-routed session selection can stay query-based to avoid static export path coupling."
  },
  {
    label: "Archive support",
    detail: "Archived sessions can render from controller-backed list queries without Next.js server routes."
  },
  {
    label: "Recovery cues",
    detail: "Interrupted runs will surface here once controller recovery APIs are added."
  }
];

export default function SessionsPage() {
  return (
    <PageFrame
      pathname="/sessions"
      title="Sessions"
      description="A static-export-safe entry point for browsing conversation history from the local controller."
    >
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Session browser</span>
            <CardTitle>Controller-backed history surface</CardTitle>
          </div>
          <CardDescription className="muted">
            Session data will be hydrated on the client so the Electron renderer can remain a pure static bundle.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <ul className="session-list">
            {sessionStates.map((item) => (
              <li key={item.label}>
                <Card variant="muted" padding="sm" className="card card-muted stack-tight">
                  <strong>{item.label}</strong>
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
