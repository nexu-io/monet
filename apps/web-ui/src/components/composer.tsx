"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button } from "@nexu-design/ui-web";

export interface ComposerProps {
  readonly value: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly canRegenerate: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
}

function getStatusHint(status: ComposerProps["status"]) {
  switch (status) {
    case "submitted":
      return "Sending prompt to /api/chat...";
    case "streaming":
      return "Streaming reply from /api/chat...";
    case "error":
      return "Last request failed. Edit the prompt or regenerate to retry.";
    default:
      return "Connected to the local controller chat route";
  }
}

export function Composer({ value, status, canRegenerate, onValueChange, onSubmit, onRegenerate, onStop }: ComposerProps) {
  const isBusy = status === "submitted" || status === "streaming";
  const sendLabel = status === "submitted" ? "Sending..." : status === "streaming" ? "Streaming..." : "Send";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onValueChange(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form className="composer" aria-label="Chat composer" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="chat-composer-input">
        Message
      </label>
      <textarea
        id="chat-composer-input"
        className="composer-input"
        rows={4}
        placeholder="Ask Monet to inspect the local app, wire providers, or continue the current implementation loop..."
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isBusy}
      />

      <div className="composer-footer">
        <div className="composer-hints">
          <span>Shift+Enter adds a newline. Ctrl/Cmd+Enter sends.</span>
          <span>{getStatusHint(status)}</span>
        </div>

        <div className="composer-actions">
          <Button type="button" variant="secondary" disabled>
            Attach context
          </Button>
          <Button type="button" variant="secondary" onClick={onRegenerate} disabled={!canRegenerate}>
            Regenerate
          </Button>
          <Button type="button" variant="secondary" onClick={onStop} disabled={!isBusy}>
            Stop
          </Button>
          <Button type="submit" variant="primary" disabled={isBusy || value.trim().length === 0}>
            {sendLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
