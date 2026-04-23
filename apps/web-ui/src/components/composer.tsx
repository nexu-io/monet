"use client";

import type { ChangeEvent, FormEvent } from "react";
import { Button } from "@nexu-design/ui-web";

export interface ComposerProps {
  readonly value: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function Composer({ value, status, onValueChange, onSubmit }: ComposerProps) {
  const isBusy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onValueChange(event.target.value);
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
        disabled={isBusy}
      />

      <div className="composer-footer">
        <div className="composer-hints">
          <span>Enter keeps multiline composer behavior for a later task</span>
          <span>{isBusy ? "Streaming reply from /api/chat..." : "Connected to the local controller chat route"}</span>
        </div>

        <div className="composer-actions">
          <Button type="button" variant="secondary" disabled>
            Attach context
          </Button>
          <Button type="submit" variant="primary" disabled={isBusy || value.trim().length === 0}>
            {isBusy ? "Streaming..." : "Send"}
          </Button>
        </div>
      </div>
    </form>
  );
}
