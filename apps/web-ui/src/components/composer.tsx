"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

export interface ComposerProps {
  readonly value: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly readyProviders?: readonly ProviderReadinessTarget[];
  readonly activeTarget?: ProviderReadinessTarget | null;
  readonly isTargetOverridden?: boolean;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
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
      return "Last request failed. Edit the prompt and send again to retry.";
    default:
      return null;
  }
}

export function Composer({
  value,
  status,
  disabled = false,
  disabledReason,
  readyProviders = [],
  activeTarget = null,
  isTargetOverridden = false,
  onValueChange,
  onSubmit,
  onStop,
  onChangeTarget
}: ComposerProps) {
  const isBusy = status === "submitted" || status === "streaming";
  const isDisabled = disabled || isBusy;
  const sendLabel = status === "submitted" ? "Sending…" : status === "streaming" ? "Stop" : "Send";
  const isStreaming = status === "streaming";
  const statusHint = getStatusHint(status, disabledReason);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isStreaming) {
      onStop();
      return;
    }

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

      if (isStreaming) {
        onStop();
        return;
      }

      onSubmit();
    }
  }

  function getTargetValue(target: ProviderReadinessTarget | null) {
    return target ? `${target.providerId}::${target.modelId}` : "";
  }

  function handleModelChange(value: string) {

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
              <Select value={getTargetValue(activeTarget)} onValueChange={handleModelChange} disabled={isDisabled}>
                <SelectTrigger
                  id="chat-composer-model"
                  className="h-8 max-w-64 rounded-md border-border-subtle bg-surface-0 px-2 py-1 text-xs font-medium text-text-secondary shadow-xs hover:border-border-hover focus:border-border-hover focus:ring-0 focus:shadow-focus"
                  title={isTargetOverridden ? "Custom model selected for this chat" : "Chat model"}
                >
                  <SelectValue placeholder="Chat model" />
                </SelectTrigger>
                <SelectContent className="border-border-subtle shadow-dropdown">
                  {readyProviders.map((target) => (
                    <SelectItem key={getTargetValue(target)} value={getTargetValue(target)}>
                      {target.modelName} ({target.providerDisplayName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isTargetOverridden ? <span className="text-xs text-accent">custom</span> : null}
            </>
          ) : null}
          {statusHint ? (
            <>
              <span>{statusHint}</span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 max-app:w-full">
          <Button
            type={isStreaming ? "button" : "submit"}
            variant={isStreaming ? "secondary" : "primary"}
            size="sm"
            onClick={isStreaming ? onStop : undefined}
            disabled={disabled || status === "submitted" || (!isStreaming && value.trim().length === 0)}
          >
            {sendLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
