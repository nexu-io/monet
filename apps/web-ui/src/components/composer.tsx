"use client";

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@nexu-design/ui-web";

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

  if (status === "error") {
    return "Last request failed. Edit the prompt and send again to retry.";
  }

  return null;
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
      className="flex flex-col gap-2 rounded-2xl border border-border-subtle bg-surface-0 p-2 shadow-lg transition-[box-shadow,border-color] duration-[var(--duration-normal)] ease-[var(--ease-standard)] focus-within:border-border-strong focus-within:shadow-xl"
      aria-label="Chat composer"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="chat-composer-input">
        Message
      </label>
      <Textarea
        id="chat-composer-input"
        className="max-h-[min(40vh,calc(var(--spacing)*60))] min-h-[3.5rem] border-0 bg-transparent focus-visible:border-0 focus-visible:ring-0"
        rows={2}
        placeholder={
          disabledReason ?? "Reply, continue the task, or ask for a new direction…"
        }
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 max-app:flex-col max-app:items-start">
        <div className="-ml-2 flex flex-wrap items-center gap-2 text-sm text-text-tertiary">
          {readyProviders.length > 0 && onChangeTarget ? (
            <>
              <label className="sr-only" htmlFor="chat-composer-model">
                Model
              </label>
              <div className="relative">
                <Select value={getTargetValue(activeTarget)} onValueChange={handleModelChange} disabled={isDisabled}>
                  <SelectTrigger
                    id="chat-composer-model"
                    className="inline-flex h-8 w-fit max-w-64 rounded-md border-0 bg-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-text-secondary shadow-none hover:bg-app-hover focus:border-0 focus:ring-0 focus:shadow-none [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"
                    title={isTargetOverridden ? "Custom model selected for this chat" : "Chat model"}
                  >
                    <SelectValue placeholder="Chat model" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80 w-max max-w-[min(32rem,calc(100vw-2rem))] border-border-subtle text-text-primary" align="start" side="top">
                    <SelectGroup>
                      {readyProviders.map((target) => {
                        const value = getTargetValue(target);

                        return (
                          <SelectItem key={value} value={value} textValue={target.modelName ?? undefined} className="text-sm">
                            <span className="flex items-baseline gap-2">
                              <span>{target.modelName}</span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
