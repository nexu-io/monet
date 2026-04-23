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
        <p>The center canvas now renders AI SDK-style message parts directly, including collapsed reasoning and tool cards.</p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="secondary" size="sm" radius="full">UIMessage parts ready</Badge>
        <Badge variant="secondary" size="sm" radius="full">Reasoning collapsed</Badge>
        <Button type="button" variant="secondary">Session settings</Button>
      </div>
    </div>
  );
}
