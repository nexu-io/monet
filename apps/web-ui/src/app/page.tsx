"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { Card } from "@nexu-design/ui-web";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";
import { getSettingsHref } from "../components/settings-panel-content";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { useControllerState } from "../lib/controller-state";
import type { ProviderReadinessTarget } from "../lib/provider-readiness";
import type { SessionDetailRecord } from "../lib/session-api";

interface PendingContinuationRequest {
  readonly runId: string;
  readonly toolCallId: string;
  readonly decision: "approved" | "rejected";
  readonly confirmationToken: string;
}

function deriveSessionTitle(input: string) {
  const normalized = input.trim().replace(/\s+/g, " ");

  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized.slice(0, 57).trimEnd()}...`;
}

function SessionChatSurface({
  session,
  fallbackProviderTarget,
  readyProviders,
  onRenameSession,
  onRefreshCurrentSession,
  onRefreshSessions
}: {
  session: SessionDetailRecord;
  fallbackProviderTarget: ProviderReadinessTarget | null;
  readyProviders: ProviderReadinessTarget[];
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onRefreshCurrentSession: () => Promise<void>;
  onRefreshSessions: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [approvalErrorText, setApprovalErrorText] = useState<string | undefined>(undefined);
  const [overrideProviderTarget, setOverrideProviderTarget] = useState<ProviderReadinessTarget | null>(null);
  const pendingContinuationRef = useRef<PendingContinuationRequest | null>(null);
  const { config } = useControllerState();
  const controllerConfig = config;
  const activeProviderTarget = overrideProviderTarget ?? fallbackProviderTarget;
  const resolvedProviderId = activeProviderTarget?.providerId ?? null;
  const resolvedModelId = activeProviderTarget?.modelId ?? null;
  const initialMessages = useMemo(() => session.messages.map((message) => message.uiMessage), [session.id, session.messages]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${controllerConfig?.apiBase ?? "http://127.0.0.1:3030"}/api/chat`,
        credentials: "omit",
        headers: (): Record<string, string> => {
          if (!controllerConfig?.bearerToken) {
            return {};
          }

          return {
            Authorization: `Bearer ${controllerConfig.bearerToken}`
          };
        },
        body: {
          sessionId: session.id,
          ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
          ...(resolvedModelId ? { modelId: resolvedModelId } : {})
        },
        prepareSendMessagesRequest: ({ api, body, headers, credentials }) => {
          const pendingContinuation = pendingContinuationRef.current;

          if (!pendingContinuation) {
            return {
              api,
              body: body ?? {},
              headers,
              credentials
            };
          }

          return {
            api: `${controllerConfig?.apiBase ?? "http://127.0.0.1:3030"}/api/runs/${pendingContinuation.runId}/continue`,
            headers,
            credentials,
            body: {
              ...body,
              ...pendingContinuation
            }
          };
        }
      }),
    [controllerConfig?.apiBase, controllerConfig?.bearerToken, resolvedModelId, resolvedProviderId, session.id]
  );
  const { messages, sendMessage, regenerate, stop, status, error, clearError, addToolApprovalResponse } = useChat({
    id: session.id,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: async () => {
      pendingContinuationRef.current = null;
      await onRefreshCurrentSession();
      await onRefreshSessions();
    }
  });
  const isBusy = status === "submitted" || status === "streaming";
  const canRegenerate = !isBusy && messages.some((message) => message.role === "user");
  const hasUserMessages = messages.some((message) => message.role === "user");
  const isArchived = session.archivedAt !== null;
  const isProviderUnavailable = !resolvedProviderId || !resolvedModelId;
  const isComposerDisabled = isArchived || isProviderUnavailable;
  const composerDisabledReason = isArchived
    ? "This session is archived. Create a new session or switch to an active one to continue chatting."
    : "Complete provider setup in Model Settings before starting a chat.";

  useEffect(() => {
    if (!overrideProviderTarget) {
      return;
    }

    const stillReady = readyProviders.some(
      (target) => target.providerId === overrideProviderTarget.providerId && target.modelId === overrideProviderTarget.modelId
    );

    if (!stillReady) {
      setOverrideProviderTarget(null);
    }
  }, [overrideProviderTarget, readyProviders]);

  function handleChangeProviderTarget(target: ProviderReadinessTarget | null) {
    if (
      target &&
      fallbackProviderTarget &&
      target.providerId === fallbackProviderTarget.providerId &&
      target.modelId === fallbackProviderTarget.modelId
    ) {
      setOverrideProviderTarget(null);
      return;
    }

    setOverrideProviderTarget(target);
  }

  async function handleSubmit() {
    const text = input.trim();

    if (!text || isBusy || isComposerDisabled) {
      return;
    }

    if (session.title === DEFAULT_SESSION_TITLE && !hasUserMessages) {
      await onRenameSession(session.id, deriveSessionTitle(text));
    }

    pendingContinuationRef.current = null;
    await sendMessage({ text });
    setInput("");
  }

  async function handleRegenerate() {
    if (!canRegenerate || isComposerDisabled) {
      return;
    }

    if (error) {
      clearError();
    }

    pendingContinuationRef.current = null;
    await regenerate();
  }

  function handleStop() {
    if (!isBusy) {
      return;
    }

    stop();
  }

  function handleInputChange(value: string) {
    if (error) {
      clearError();
    }

    if (approvalErrorText) {
      setApprovalErrorText(undefined);
    }

    setInput(value);
  }

  async function handleToolApproval(input: PendingContinuationRequest) {
    if (isBusy || isComposerDisabled) {
      throw new Error("Tool confirmation is unavailable right now.");
    }

    setApprovalErrorText(undefined);

    const headers = new Headers({
      "content-type": "application/json"
    });

    if (controllerConfig?.bearerToken) {
      headers.set("Authorization", `Bearer ${controllerConfig.bearerToken}`);
    }

    const response = await fetch(`${controllerConfig?.apiBase ?? "http://127.0.0.1:3030"}/api/tools/confirm`, {
      method: "POST",
      headers,
      credentials: "omit",
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      let errorMessage = "Failed to confirm tool execution.";

      try {
        const payload = (await response.json()) as { message?: string };
        errorMessage = payload.message ?? errorMessage;
      } catch {
        // keep generic fallback
      }

      setApprovalErrorText(errorMessage);
      throw new Error(errorMessage);
    }

    pendingContinuationRef.current = input;
    await addToolApprovalResponse({
      id: input.confirmationToken,
      approved: input.decision === "approved"
    });
  }

  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and ready for AI SDK UI message rendering."
      onDesktopStopShortcut={handleStop}
      header={(
        <ConversationHeader
          sessionTitle={session.title}
          sessionId={session.id}
          status={status}
          messageCount={messages.length}
          hasError={error != null || approvalErrorText != null}
          canRegenerate={canRegenerate && !isComposerDisabled}
          readyProviders={readyProviders}
          activeTarget={activeProviderTarget}
          isTargetOverridden={overrideProviderTarget !== null}
          onChangeTarget={handleChangeProviderTarget}
          onRegenerate={() => void handleRegenerate()}
          onStop={handleStop}
        />
      )}
      composer={(
        <Composer
          value={input}
          status={status}
          canRegenerate={canRegenerate}
          disabled={isComposerDisabled}
          {...(isComposerDisabled ? { disabledReason: composerDisabledReason } : {})}
          onValueChange={handleInputChange}
          onSubmit={() => void handleSubmit()}
          onRegenerate={() => void handleRegenerate()}
          onStop={handleStop}
        />
      )}
    >
      <div className="chat-thread-layout">
        <ControllerStatusCard />
        <ChatThread
          messages={messages}
          status={status}
          errorText={approvalErrorText ?? error?.message}
          isArchived={isArchived}
          onToolApproval={handleToolApproval}
        />
      </div>
    </PageFrame>
  );
}

export default function HomePage() {
  const { controllerState, isDesktop, restartController, restartPending } = useControllerState();
  const {
    createSession,
    currentSessionDetail,
    isCurrentSessionLoading,
    isSessionsLoading,
    providerReadiness,
    refreshCurrentSession,
    refreshSessions,
    renameSession,
    sessions,
    sessionsError
  } = useSessions();

  const hasActiveSessions = sessions.some((session) => session.archivedAt === null);
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const blankStateHref = getSettingsHref("/", new URLSearchParams(), "models");
  const controllerStateLabel = controllerState?.state;

  async function handleRenameSession(sessionId: string, title: string) {
    try {
      await renameSession(sessionId, title);
    } catch {
      // Keep chat flow moving even if the auto-title request fails.
    }
  }

  if (!currentSessionDetail) {
    const isStartupLoading = isSessionsLoading || isCurrentSessionLoading || providerReadiness.loading;
    const title = controllerStateLabel === "starting"
      ? "Starting local controller..."
      : controllerStateLabel === "restarting"
        ? "Restarting local controller..."
        : controllerStateLabel === "failed"
          ? "Local controller failed to start"
          : controllerStateLabel === "stopped"
            ? "Local controller stopped unexpectedly"
            : isStartupLoading
              ? "Loading startup state..."
              : providerSetupRequired
                ? "Finish provider setup before starting chat"
                : !hasActiveSessions
                  ? "Start your first chat"
                  : "No active session selected.";
    const description = controllerStateLabel === "starting" || controllerStateLabel === "restarting"
      ? controllerState?.message ?? "Waiting for the desktop shell to finish wiring the local controller and renderer."
      : controllerStateLabel === "failed" || controllerStateLabel === "stopped"
        ? controllerState?.message ?? "Restart the local controller to recover chat, sessions, and settings requests."
        : providerSetupRequired
          ? "Monet opens Model Settings first when no validated provider can resolve a default model for new chats."
          : !hasActiveSessions
            ? "There are no active sessions yet. Create one to land in the blank conversation state."
            : sessionsError ?? "Select a recent session from the sidebar or create a fresh one.";

    return (
      <PageFrame
        pathname="/"
        title="Agent Chat"
        description="Desktop-first chat shell wired for a local Hono controller and ready for AI SDK UI message rendering."
      >
        <Card className="card stack-tight session-browser-empty">
          <span className="eyebrow">Startup state</span>
          <strong>{title}</strong>
          <p className="muted">{description}</p>
          {sessionsError ? <p className="muted mono">{sessionsError}</p> : null}
          {!isStartupLoading && controllerStateLabel !== "starting" && controllerStateLabel !== "restarting" ? (
            <div className="session-browser-actions">
              {isDesktop && (controllerStateLabel === "failed" || controllerStateLabel === "stopped") ? (
                <button type="button" className="session-action-button session-action-button-primary" onClick={() => void restartController()} disabled={restartPending}>
                  {restartPending ? "Restarting controller..." : "Restart controller"}
                </button>
              ) : providerSetupRequired ? (
                <Link href={blankStateHref} className="session-action-button session-action-button-primary">
                  Open model settings
                </Link>
              ) : (
                <button type="button" className="session-action-button session-action-button-primary" onClick={() => void createSession({ pathname: "/" })}>
                  Create session
                </button>
              )}
              {!providerSetupRequired && hasActiveSessions ? (
                <Link href="/sessions" className="session-action-button">
                  View all sessions
                </Link>
              ) : null}
            </div>
          ) : null}
        </Card>
      </PageFrame>
    );
  }

  return (
    <SessionChatSurface
      key={currentSessionDetail.id}
      session={currentSessionDetail}
      readyProviders={providerReadiness.data?.readyProviders ?? []}
      fallbackProviderTarget={
        providerReadiness.data?.readyProviders.find(
          (provider) => provider.providerId === currentSessionDetail.defaultProviderId && provider.modelId === currentSessionDetail.defaultModelId
        ) ?? providerReadiness.data?.firstReadyProvider ?? null
      }
      onRenameSession={handleRenameSession}
      onRefreshCurrentSession={refreshCurrentSession}
      onRefreshSessions={refreshSessions}
    />
  );
}
