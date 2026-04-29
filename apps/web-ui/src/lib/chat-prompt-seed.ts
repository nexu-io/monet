export const PENDING_CHAT_PROMPT_STORAGE_KEY = "monet.pendingPrompt";

export const LIVE_ARTIFACT_DISCOVERY_PROMPT = `I want to make a live artifact.

Please explain what Live Artifacts are in one short paragraph, inspect my available connectors and tools, and ask clarifying questions to figure out what would be useful. Cover the connector or data source, artifact pattern such as a morning check-in, status tracker, recurring report, or investigation dashboard, usage frequency, and concrete resource anchors such as URLs, repo names, issue filters, or document IDs. Surface connector limitations honestly. When creating refreshable artifacts, keep changing values in dataJson, bind them into HTML using canonical examples like {{data.stars}}, data-bind="text:data.stars", data-bind-attr="href:data.url", data-bind-style="color:data.statusColor", and data-repeat="data.items", and set sourceJson.outputMapping.dataPaths to map dataJson fields to tool output paths; do not hardcode refreshed values and do not use script/window data injection. When we have enough detail, call create_live_artifact to create the artifact.`;

export function stashPendingChatPrompt(prompt: string) {
  window.sessionStorage.setItem(PENDING_CHAT_PROMPT_STORAGE_KEY, prompt);
}
