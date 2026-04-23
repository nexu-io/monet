"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";

export default function HomePage() {
  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and static-export-safe routing."
      header={<ConversationHeader />}
      composer={<Composer />}
    >
      <Card className="card hero chat-surface-card">
        <CardHeader className="hero-copy">
          <div className="stack-tight">
            <span className="eyebrow">Main canvas</span>
            <CardTitle>Chat canvas is now isolated from the sidebar and bottom composer</CardTitle>
          </div>
          <p>
            The center column now behaves like the eventual conversation surface: lightweight session header on top,
            scrollable content in the middle, and a dedicated composer rail pinned to the bottom.
          </p>
        </CardHeader>

        <CardContent>
          <div className="pill-row">
            <Badge variant="secondary" className="pill">Sidebar session rail</Badge>
            <Badge variant="secondary" className="pill">Scroll-safe main canvas</Badge>
            <Badge variant="secondary" className="pill">Pinned composer zone</Badge>
            <Badge variant="secondary" className="pill">Static export compatible</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="split chat-support-grid">
        <ControllerStatusCard />

        <Card className="card stack">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Next up</span>
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
