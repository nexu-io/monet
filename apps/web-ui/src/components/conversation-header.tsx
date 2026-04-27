"use client";

import { useCallback, useState } from "react";
import { Button } from "@nexu-design/ui-web";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

const headerCodeClassName = "rounded-sm bg-surface-2 px-1 font-mono text-[0.92em] text-text-heading";
const workspacePathClassName =
  "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-text-secondary";

export interface ConversationHeaderProps {
  readonly sessionId?: string;
  readonly sessionTitle: string;
  readonly messageCount: number;
  readonly workspacePath?: string | null;
  readonly activeTarget: ProviderReadinessTarget | null;
  readonly isTargetOverridden: boolean;
  readonly onChangeTarget: (target: ProviderReadinessTarget | null) => void;
}

export function ConversationHeader({
  sessionId,
  sessionTitle,
  messageCount,
  workspacePath,
  activeTarget,
  isTargetOverridden,
  onChangeTarget
}: ConversationHeaderProps) {
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;
  const canOpenWorkspace = Boolean(sessionId && desktopApi?.openWorkspaceDirectory);

  const copyWorkspacePath = useCallback(async () => {
    if (!workspacePath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(workspacePath);
      setWorkspaceFeedback("Copied workspace path.");
    } catch (error) {
      setWorkspaceFeedback(error instanceof Error ? error.message : "Unable to copy the workspace path.");
    }
  }, [workspacePath]);

  const openWorkspace = useCallback(async () => {
    if (!sessionId || !desktopApi?.openWorkspaceDirectory) {
      setWorkspaceFeedback("Opening workspace folders is available in the desktop app.");
      return;
    }

    setIsOpeningWorkspace(true);
    setWorkspaceFeedback(null);

    try {
      const result = await desktopApi.openWorkspaceDirectory({ sessionId });
      setWorkspaceFeedback(result.opened ? "Opened workspace folder." : result.error ?? "Unable to open workspace folder.");
    } catch (error) {
      setWorkspaceFeedback(error instanceof Error ? error.message : "Unable to open workspace folder.");
    } finally {
      setIsOpeningWorkspace(false);
    }
  }, [desktopApi, sessionId]);

  return (
    <div className="flex flex-col items-start gap-4 app:flex-row app:flex-wrap app:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
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
        {sessionId ? <div className="flex w-full min-w-0 flex-col gap-1.5 app:max-w-[72ch]">
          <div className="flex min-w-0 flex-col gap-2 app:flex-row app:items-center">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Workspace</span>
            <div className={workspacePathClassName} title={workspacePath ?? "Workspace path is loading."}>
              {workspacePath ?? "Workspace path is loading…"}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={!workspacePath} onClick={() => void copyWorkspacePath()}>
                Copy path
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!canOpenWorkspace || isOpeningWorkspace} onClick={() => void openWorkspace()}>
                {isOpeningWorkspace ? "Opening…" : "Open folder"}
              </Button>
            </div>
          </div>
          {workspaceFeedback ? <p className="m-0 text-sm text-text-muted">{workspaceFeedback}</p> : null}
        </div> : null}
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
