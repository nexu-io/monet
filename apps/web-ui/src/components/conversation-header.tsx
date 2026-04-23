"use client";

import { Badge, Button } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

export interface ConversationHeaderProps {
  readonly sessionTitle: string;
  readonly sessionId: string;
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly messageCount: number;
  readonly hasError: boolean;
  readonly canRegenerate: boolean;
  readonly readyProviders: ProviderReadinessTarget[];
  readonly activeTarget: ProviderReadinessTarget | null;
  readonly isTargetOverridden: boolean;
  readonly onChangeTarget: (target: ProviderReadinessTarget | null) => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
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

export function ConversationHeader({
  sessionTitle,
  sessionId,
  status,
  messageCount,
  hasError,
  canRegenerate,
  readyProviders,
  activeTarget,
  isTargetOverridden,
  onChangeTarget,
  onRegenerate,
  onStop
}: ConversationHeaderProps) {
  const isBusy = status === "submitted" || status === "streaming";
  const showProviderPicker = readyProviders.length >= 2;

  return (
    <div className="conversation-header">
      <div className="conversation-header-copy">
        <div className="stack-tight">
          <span className="eyebrow">Current session</span>
          <h1>{sessionTitle}</h1>
        </div>
        <p>
          Streaming conversation for <code>{sessionId}</code>, backed by persisted session detail from the local controller.
          {activeTarget ? (
            <>
              {" "}Active route: <code>{activeTarget.providerDisplayName}</code>
              {activeTarget.modelName ? <><span> · </span><code>{activeTarget.modelName}</code></> : null}
            </>
          ) : null}
        </p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="secondary" size="sm" radius="full">{messageCount} messages</Badge>
        <Badge variant="secondary" size="sm" radius="full">{getStatusLabel(status)}</Badge>
        <Badge variant="secondary" size="sm" radius="full">{hasError ? "Last request failed" : "Local /api/chat wired"}</Badge>
        {showProviderPicker ? (
          <label className="conversation-header-target-picker">
            <span className="eyebrow">Model</span>
            <select
              value={activeTarget ? `${activeTarget.providerId}::${activeTarget.modelId}` : ""}
              disabled={isBusy}
              onChange={(event) => {
                const nextTarget = readyProviders.find(
                  (target) => `${target.providerId}::${target.modelId}` === event.currentTarget.value
                );
                onChangeTarget(nextTarget ?? null);
              }}
            >
              {readyProviders.map((target) => (
                <option key={`${target.providerId}::${target.modelId}`} value={`${target.providerId}::${target.modelId}`}>
                  {target.providerDisplayName} · {target.modelName ?? target.modelId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isTargetOverridden ? (
          <Button type="button" variant="secondary" onClick={() => onChangeTarget(null)} disabled={isBusy}>
            Reset route
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onRegenerate} disabled={!canRegenerate}>Regenerate</Button>
        <Button type="button" variant="secondary" onClick={onStop} disabled={!isBusy}>Stop</Button>
      </div>
    </div>
  );
}
