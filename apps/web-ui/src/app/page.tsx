import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";

export default function HomePage() {
  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and static-export-safe routing."
    >
      <section className="hero card">
        <div className="hero-copy">
          <span className="eyebrow">Iteration 4</span>
          <h3>Web UI scaffolding for the Electron renderer</h3>
          <p>
            This scaffold keeps runtime behavior out of Next.js server features so the renderer can ship as static
            assets while still talking to the local controller over HTTP and SSE.
          </p>
        </div>

        <div className="pill-row">
          <div className="pill">App Router structure</div>
          <div className="pill">Static export compatible</div>
          <div className="pill">Preload-aware API config</div>
          <div className="pill">Health check plumbing</div>
        </div>
      </section>

      <div className="split">
        <ControllerStatusCard />

        <section className="card stack">
          <div>
            <span className="eyebrow">Planned chat runtime</span>
            <h3>AI SDK UI integration points</h3>
          </div>

          <ul className="feature-list">
            <li>Chat state will attach `sessionId`, provider, and model metadata on send.</li>
            <li>All dynamic data stays on the Hono controller, not in Next.js route handlers.</li>
            <li>Message rendering will be based on AI SDK UI `parts` rather than plain text only.</li>
            <li>The renderer can use preload-injected credentials in production without hard-coding localhost URLs.</li>
          </ul>
        </section>
      </div>
    </PageFrame>
  );
}
