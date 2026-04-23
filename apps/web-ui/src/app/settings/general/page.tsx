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
      <section className="card stack">
        <div>
          <span className="eyebrow">Desktop integration</span>
          <h3>Renderer runtime settings</h3>
        </div>

        <ul className="kv-list">
          {runtimeSettings.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <div className="muted">{item.detail}</div>
            </li>
          ))}
        </ul>
      </section>
    </PageFrame>
  );
}
