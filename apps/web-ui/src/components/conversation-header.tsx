"use client";

import { Badge, Button, StatusDot } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

const headerCodeClassName = "rounded-sm bg-surface-2 px-1 font-mono text-[0.92em] text-text-heading";

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
  activeTarget,
  isTargetOverridden,
  onChangeTarget,
  onRegenerate,
  onStop
}: ConversationHeaderProps) {
  const isBusy = status === "submitted" || status === "streaming";
  const statusDescriptor = getStatusDescriptor(status, hasError);

  return (
    <div className="flex flex-col items-start gap-4 app:flex-row app:flex-wrap app:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="m-0 font-heading text-3xl font-bold leading-[1.2] tracking-[-0.015em] text-text-heading">{sessionTitle}</h1>
        <p className="m-0 max-w-[72ch] text-lg text-text-secondary">
          {activeTarget ? (
            <>
              Route <code className={headerCodeClassName}>{activeTarget.providerDisplayName}</code>
              {activeTarget.modelName ? <> · <code className={headerCodeClassName}>{activeTarget.modelName}</code></> : null}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {messageCount} {messageCount === 1 ? "message" : "messages"}
          <span aria-hidden="true"> · </span>
          <code className={headerCodeClassName}>{sessionId.slice(0, 8)}</code>
        </p>
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-2 app:w-auto">
        <Badge variant="outline" radius="full" size="sm">
          <StatusDot status={statusDescriptor.tone} size="xs" className="size-2" pulse={isBusy} />
          <span>{statusDescriptor.label}</span>
        </Badge>

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
