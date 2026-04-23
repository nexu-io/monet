"use client";

import { Badge, Button } from "@nexu-design/ui-web";

export interface ConversationHeaderProps {
  readonly sessionTitle: string;
  readonly sessionId: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly messageCount: number;
  readonly hasError: boolean;
  readonly canRegenerate: boolean;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
}

function getStatusLabel(status: ConversationHeaderProps["status"]) {
  switch (status) {
    case "submitted":
      return "Submitting";
    case "streaming":
      return "Streaming";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

export function ConversationHeader({ sessionTitle, sessionId, status, messageCount, hasError, canRegenerate, onRegenerate, onStop }: ConversationHeaderProps) {
  const isBusy = status === "submitted" || status === "streaming";

  return (
    <div className="conversation-header">
      <div className="conversation-header-copy">
        <div className="stack-tight">
          <span className="eyebrow">Current session</span>
          <h1>{sessionTitle}</h1>
        </div>
        <p>Streaming conversation for <code>{sessionId}</code>, backed by persisted session detail from the local controller.</p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="secondary" size="sm" radius="full">{messageCount} messages</Badge>
        <Badge variant="secondary" size="sm" radius="full">{getStatusLabel(status)}</Badge>
        <Badge variant="secondary" size="sm" radius="full">{hasError ? "Last request failed" : "Local /api/chat wired"}</Badge>
        <Button type="button" variant="secondary" onClick={onRegenerate} disabled={!canRegenerate}>Regenerate</Button>
        <Button type="button" variant="secondary" onClick={onStop} disabled={!isBusy}>Stop</Button>
        <Button type="button" variant="secondary" disabled>Session settings</Button>
      </div>
    </div>
  );
}
