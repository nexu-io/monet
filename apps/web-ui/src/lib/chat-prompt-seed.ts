export const PENDING_CHAT_PROMPT_STORAGE_KEY = "monet.pendingPrompt";

export const LIVE_ARTIFACT_DISCOVERY_PROMPT = `I want to make a live artifact.

Please explain what Live Artifacts are in one short paragraph, inspect my available connectors and tools, and ask clarifying questions to figure out what would be useful. Cover the connector or data source, artifact pattern such as a morning check-in, status tracker, recurring report, or investigation dashboard, usage frequency, and concrete resource anchors such as URLs, repo names, issue filters, or document IDs. Surface connector limitations honestly. When we have enough detail, call create_live_artifact to create the artifact.`;

export function stashPendingChatPrompt(prompt: string) {
  window.sessionStorage.setItem(PENDING_CHAT_PROMPT_STORAGE_KEY, prompt);
}
