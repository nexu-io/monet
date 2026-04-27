"use client";

import { Button } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

const headerCodeClassName = "rounded-sm bg-surface-2 px-1 font-mono text-[0.92em] text-text-heading";

export interface ConversationHeaderProps {
  readonly sessionTitle: string;
  readonly messageCount: number;
  readonly activeTarget: ProviderReadinessTarget | null;
  readonly isTargetOverridden: boolean;
  readonly onChangeTarget: (target: ProviderReadinessTarget | null) => void;
}

export function ConversationHeader({
  sessionTitle,
  messageCount,
  activeTarget,
  isTargetOverridden,
  onChangeTarget
}: ConversationHeaderProps) {
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
        </p>
      </div>

      <div className="flex w-full flex-wrap items-center justify-end gap-2 app:w-auto">
        {isTargetOverridden ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChangeTarget(null)}>
            Reset route
          </Button>
        ) : null}
      </div>
    </div>
  );
}
