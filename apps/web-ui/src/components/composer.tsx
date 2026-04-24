"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button } from "@nexu-design/ui-web";

export interface ComposerProps {
  readonly value: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly canRegenerate: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
}

function getStatusHint(status: ComposerProps["status"], disabledReason?: string) {
  if (disabledReason) {
    return disabledReason;
  }

  switch (status) {
    case "submitted":
      return "Sending prompt…";
    case "streaming":
      return "Streaming reply…";
    case "error":
      return "Last request failed. Edit the prompt or regenerate to retry.";
    default:
      return null;
  }
}

export function Composer({
  value,
  status,
  canRegenerate,
  disabled = false,
  disabledReason,
  onValueChange,
  onSubmit,
  onRegenerate,
  onStop
}: ComposerProps) {
  const isBusy = status === "submitted" || status === "streaming";
  const isDisabled = disabled || isBusy;
  const sendLabel = status === "submitted" ? "Sending…" : status === "streaming" ? "Streaming…" : "Send";
  const statusHint = getStatusHint(status, disabledReason);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onValueChange(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
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
        rows={3}
        placeholder={
          disabledReason ?? "Reply, continue the task, or ask for a new direction…"
        }
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
      />

      <div className="composer-footer">
        <div className="composer-hints">
          <kbd>⏎</kbd>
          <span>to send</span>
          <span aria-hidden="true">·</span>
          <kbd>⇧</kbd>
          <kbd>⏎</kbd>
          <span>for newline</span>
          {statusHint ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{statusHint}</span>
            </>
          ) : null}
        </div>

        <div className="composer-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onRegenerate} disabled={disabled || !canRegenerate}>
            Regenerate
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onStop} disabled={disabled || !isBusy}>
            Stop
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={isDisabled || value.trim().length === 0}>
            {sendLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
