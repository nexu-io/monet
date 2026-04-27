"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { Button } from "@nexu-design/ui-web";

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
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
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
    setIsModelMenuOpen(false);
  }

  useEffect(() => {
    if (!isModelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setIsModelMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isModelMenuOpen]);

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
              <div ref={modelMenuRef} className="relative">
                <button
                  id="chat-composer-model"
                  type="button"
                  className="flex h-8 max-w-64 items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-0 px-2 py-1 text-xs font-medium text-text-secondary shadow-xs outline-none transition-colors hover:border-border-hover focus:border-border-hover focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
                  title={isTargetOverridden ? "Custom model selected for this chat" : "Chat model"}
                  aria-haspopup="listbox"
                  aria-expanded={isModelMenuOpen}
                  disabled={isDisabled}
                  onClick={() => setIsModelMenuOpen((open) => !open)}
                >
                  <span className="truncate">
                    {activeTarget ? `${activeTarget.modelName} (${activeTarget.providerDisplayName})` : "Chat model"}
                  </span>
                  <span aria-hidden="true" className="text-text-muted">⌄</span>
                </button>
                {isModelMenuOpen ? (
                  <div
                    className="absolute bottom-[calc(100%+0.25rem)] left-0 z-50 max-h-80 min-w-full w-max max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border-subtle bg-surface-0 p-1 text-text-primary shadow-dropdown"
                    role="listbox"
                    aria-labelledby="chat-composer-model"
                  >
                    {readyProviders.map((target) => {
                      const value = getTargetValue(target);
                      const isSelected = value === getTargetValue(activeTarget);

                      return (
                        <button
                          key={value}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-1 aria-selected:bg-surface-1"
                          onClick={() => handleModelChange(value)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {target.modelName} ({target.providerDisplayName})
                          </span>
                          {isSelected ? <span className="shrink-0 text-text-primary">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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
