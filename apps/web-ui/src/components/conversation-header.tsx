"use client";

import { Badge, Button, StatusDot } from "@nexu-design/ui-web";

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

function getStatusDescriptor(status: ConversationHeaderProps["status"], hasError: boolean) {
  if (hasError) {
    return { label: "Attention", tone: "error" as const };
  }

  switch (status) {
    case "submitted":
      return { label: "Submitting", tone: "warning" as const };
    case "streaming":
      return { label: "Streaming", tone: "warning" as const };
    case "error":
      return { label: "Error", tone: "error" as const };
    default:
      return { label: "Ready", tone: "success" as const };
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
  const statusDescriptor = getStatusDescriptor(status, hasError);

  return (
    <div className="conversation-header">
      <div className="conversation-header-copy">
        <h1>{sessionTitle}</h1>
        <p>
          {activeTarget ? (
            <>
              Route <code>{activeTarget.providerDisplayName}</code>
              {activeTarget.modelName ? <> · <code>{activeTarget.modelName}</code></> : null}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {messageCount} {messageCount === 1 ? "message" : "messages"}
          <span aria-hidden="true"> · </span>
          <code>{sessionId.slice(0, 8)}</code>
        </p>
      </div>

      <div className="conversation-header-actions">
        <Badge variant="outline" radius="full" size="sm" className="status-inline">
          <StatusDot status={statusDescriptor.tone} size="xs" className="size-2" pulse={isBusy} />
          <span>{statusDescriptor.label}</span>
        </Badge>

        {showProviderPicker ? (
          <label className="conversation-header-target-picker">
            <span className="conversation-header-target-picker-label">Model</span>
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
          <Button type="button" variant="ghost" size="sm" onClick={() => onChangeTarget(null)} disabled={isBusy}>
            Reset route
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onRegenerate} disabled={!canRegenerate}>
          Regenerate
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onStop} disabled={!isBusy}>
          Stop
        </Button>
      </div>
    </div>
  );
}
