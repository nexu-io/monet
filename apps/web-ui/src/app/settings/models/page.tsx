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
      <section className="card stack">
        <div>
          <span className="eyebrow">Provider configuration</span>
          <h3>Model routing and defaults</h3>
        </div>

        <ul className="settings-list">
          {modelSettings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </PageFrame>
  );
}
