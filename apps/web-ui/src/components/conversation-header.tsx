"use client";

import { Badge, Button } from "@nexu-design/ui-web";

export function ConversationHeader() {
  return (
    <div className="conversation-header">
      <div className="conversation-header-copy">
        <div className="stack-tight">
          <span className="eyebrow">Current session</span>
          <h1>Install and upgrade strategy</h1>
        </div>
        <p>Three-part shell in place now; next iterations can swap the placeholder stream for real AI SDK chat messages.</p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="secondary" size="sm" radius="full">OpenAI pending</Badge>
        <Badge variant="secondary" size="sm" radius="full">gpt-4.1 planned</Badge>
        <Button type="button" variant="secondary">Session settings</Button>
      </div>
    </div>
  );
}
