"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

export interface ComposerProps {
  readonly value: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly canRegenerate: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly readyProviders?: readonly ProviderReadinessTarget[];
  readonly activeTarget?: ProviderReadinessTarget | null;
  readonly isTargetOverridden?: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
  readonly onChangeTarget?: (target: ProviderReadinessTarget | null) => void;
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
  readyProviders = [],
  activeTarget = null,
  isTargetOverridden = false,
  onValueChange,
  onSubmit,
  onRegenerate,
  onStop,
  onChangeTarget
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

  function getTargetValue(target: ProviderReadinessTarget | null) {
    return target ? `${target.providerId}::${target.modelId}` : "";
  }

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.currentTarget.value;

    if (!value) {
      onChangeTarget?.(null);
      return;
    }

    const target = readyProviders.find((candidate) => getTargetValue(candidate) === value) ?? null;
    onChangeTarget?.(target);
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-xs transition-[box-shadow,border-color] duration-[var(--duration-normal)] ease-[var(--ease-standard)] focus-within:border-border-strong focus-within:shadow-sm"
      aria-label="Chat composer"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="chat-composer-input">
        Message
      </label>
      <textarea
        id="chat-composer-input"
        className="max-h-[min(40vh,calc(var(--spacing)*60))] min-h-18 w-full resize-none border-0 bg-transparent p-0 font-sans text-xl leading-[1.55] text-text-primary outline-none placeholder:text-text-placeholder"
        rows={3}
        placeholder={
          disabledReason ?? "Reply, continue the task, or ask for a new direction…"
        }
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 max-app:flex-col max-app:items-start">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary">
          {readyProviders.length > 0 && onChangeTarget ? (
            <>
              <label className="sr-only" htmlFor="chat-composer-model">
                Model
              </label>
              <select
                id="chat-composer-model"
                value={getTargetValue(activeTarget)}
                onChange={handleModelChange}
                disabled={isDisabled}
                className="min-h-8 max-w-64 rounded-md border border-border-subtle bg-surface-0 px-2 py-1 text-xs font-medium text-text-secondary outline-none transition-colors hover:border-border-strong focus:border-accent focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60"
                title={isTargetOverridden ? "Custom model selected for this chat" : "Chat model"}
              >
                {readyProviders.map((target) => (
                  <option key={getTargetValue(target)} value={getTargetValue(target)}>
                    {target.providerDisplayName} · {target.modelName ?? target.modelId}
                  </option>
                ))}
              </select>
              {isTargetOverridden ? <span className="text-xs text-accent">custom</span> : null}
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⏎</kbd>
          <span>to send</span>
          <span aria-hidden="true">·</span>
          <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⇧</kbd>
          <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⏎</kbd>
          <span>for newline</span>
          {statusHint ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{statusHint}</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 max-app:w-full">
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
