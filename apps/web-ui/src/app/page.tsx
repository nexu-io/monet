"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";

export default function HomePage() {
  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and static-export-safe routing."
    >
      <Card className="card hero">
        <CardHeader className="hero-copy">
          <div className="stack-tight">
            <span className="eyebrow">Iteration 4</span>
            <CardTitle>Web UI scaffolding for the Electron renderer</CardTitle>
          </div>
          <p>
            This scaffold keeps runtime behavior out of Next.js server features so the renderer can ship as static
            assets while still talking to the local controller over HTTP and SSE.
          </p>
        </CardHeader>

        <CardContent>
          <div className="pill-row">
            <Badge variant="secondary" className="pill">App Router structure</Badge>
            <Badge variant="secondary" className="pill">Static export compatible</Badge>
            <Badge variant="secondary" className="pill">Preload-aware API config</Badge>
            <Badge variant="secondary" className="pill">Health check plumbing</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="split">
        <ControllerStatusCard />

        <Card className="card stack">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Planned chat runtime</span>
              <CardTitle>AI SDK UI integration points</CardTitle>
            </div>
          </CardHeader>

          <CardContent>
            <ul className="feature-list">
              <li>Chat state will attach `sessionId`, provider, and model metadata on send.</li>
              <li>All dynamic data stays on the Hono controller, not in Next.js route handlers.</li>
              <li>Message rendering will be based on AI SDK UI `parts` rather than plain text only.</li>
              <li>The renderer can use preload-injected credentials in production without hard-coding localhost URLs.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  );
}
