"use client";

import { Badge, Button } from "@nexu-design/ui-web";

export interface ConversationHeaderProps {
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly messageCount: number;
  readonly hasError: boolean;
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

export function ConversationHeader({ status, messageCount, hasError }: ConversationHeaderProps) {
  return (
    <div className="conversation-header">
      <div className="conversation-header-copy">
        <div className="stack-tight">
          <span className="eyebrow">Current session</span>
          <h1>Install and upgrade strategy</h1>
        </div>
        <p>The center canvas is now wired through `useChat` to the local controller, and assistant replies stream back into the same UIMessage parts renderer.</p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="secondary" size="sm" radius="full">{messageCount} messages</Badge>
        <Badge variant="secondary" size="sm" radius="full">{getStatusLabel(status)}</Badge>
        <Badge variant="secondary" size="sm" radius="full">{hasError ? "Last request failed" : "Local /api/chat wired"}</Badge>
        <Button type="button" variant="secondary" disabled>Session settings</Button>
      </div>
    </div>
  );
}
