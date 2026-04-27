"use client";

import { useCallback, useState } from "react";
import { Button } from "@nexu-design/ui-web";
import { FolderOpen } from "lucide-react";

import type { ProviderReadinessTarget } from "../lib/provider-readiness";

const headerCodeClassName = "rounded-sm bg-surface-2 px-1 font-mono text-[0.92em] text-text-heading";

export interface ConversationHeaderProps {
  readonly sessionId?: string;
  readonly sessionTitle: string;
  readonly messageCount: number;
  readonly activeTarget: ProviderReadinessTarget | null;
}

export function ConversationHeader({
  sessionId,
  sessionTitle,
  messageCount,
  activeTarget
}: ConversationHeaderProps) {
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;
  const supportsOpenWorkspace = Boolean(desktopApi?.openWorkspaceDirectory);
  const canOpenWorkspace = Boolean(sessionId && supportsOpenWorkspace);
  const isMacDesktop = desktopApi?.platform === "darwin";
  const openingWorkspaceLabel = isMacDesktop ? "Opening Finder…" : "Opening…";

  const openWorkspace = useCallback(async () => {
    if (!sessionId || !desktopApi?.openWorkspaceDirectory) {
      setWorkspaceFeedback("Opening workspace folders is available in the desktop app.");
      return;
    }

    setIsOpeningWorkspace(true);
    setWorkspaceFeedback(null);

    try {
      const result = await desktopApi.openWorkspaceDirectory({ sessionId });
      if (result.opened) {
        setWorkspaceFeedback(null);
      } else {
        const details = [result.errorDetails?.workspacePath, result.errorDetails?.nativeOpenFailureReason]
          .filter(Boolean)
          .join(" — ");
        setWorkspaceFeedback([result.error ?? "Unable to open workspace folder.", details].filter(Boolean).join(" "));
      }
    } catch (error) {
      setWorkspaceFeedback(error instanceof Error ? error.message : "Unable to open workspace folder.");
    } finally {
      setIsOpeningWorkspace(false);
    }
  }, [desktopApi, isMacDesktop, sessionId]);

  return (
    <div className="flex flex-col items-start gap-4 app:flex-row app:flex-wrap app:items-center app:justify-between">
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
      </div>
      {sessionId && supportsOpenWorkspace ? <div className="flex flex-col items-start gap-1.5 app:items-end">
        <Button type="button" variant="secondary" size="sm" disabled={!canOpenWorkspace || isOpeningWorkspace} onClick={() => void openWorkspace()}>
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {isOpeningWorkspace ? openingWorkspaceLabel : "Open in Finder"}
          </span>
        </Button>
        {workspaceFeedback ? <p className="m-0 text-sm text-text-muted">{workspaceFeedback}</p> : null}
      </div> : null}
    </div>
  );
}
