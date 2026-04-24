"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { PageFrame } from "../components/page-frame";
import { WelcomeHome } from "../components/welcome-home";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { sanitizeInternalRuntimeMessage } from "../components/workspace-copy";
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

  // Pick up any pending prompt stashed by the welcome surface and auto-send it
  // so landing into a fresh session feels seamless.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isComposerDisabled || hasUserMessages) return;

    const pending = window.sessionStorage.getItem("monet.pendingPrompt");
    if (!pending) return;

    window.sessionStorage.removeItem("monet.pendingPrompt");

    void (async () => {
      if (session.title === DEFAULT_SESSION_TITLE) {
        await onRenameSession(session.id, deriveSessionTitle(pending));
      }
      pendingContinuationRef.current = null;
      await sendMessage({ text: pending });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, isComposerDisabled]);

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

    try {
      await addToolApprovalResponse({
        id: input.confirmationToken,
        approved: input.decision === "approved"
      });
      pendingContinuationRef.current = input;
    } catch (error) {
      pendingContinuationRef.current = null;
      throw error;
    }
  }

  return (
    <PageFrame
      pathname="/"
      title="Chat"
      description="Desktop-first chat shell wired to your local workspace with streaming AI SDK UI message rendering."
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

/**
 * Home route.
 *
 * Two visual states:
 *   - Welcome: no active session (first run, archived, or between chats) →
 *     a large centered hero with badge, greeting, big prompt card, info/recents grids.
 *   - Chat: an active session detail is loaded → classic conversation surface
 *     with header, streaming thread, and composer.
 */
export default function HomePage() {
  const { controllerState, isDesktop, restartController, restartPending } = useControllerState();
  const {
    createSession,
    currentSessionDetail,
    isCurrentSessionLoading,
    isSessionsLoading,
    openSession,
    providerReadiness,
    refreshCurrentSession,
    refreshSessions,
    renameSession,
    sessions,
    sessionsError
  } = useSessions();

  const activeSessions = sessions.filter((session) => session.archivedAt === null);
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const modelSettingsHref = "/settings/models";
  const controllerStateLabel = controllerState?.state;
  const readyProviders = providerReadiness.data?.readyProviders ?? [];
  const activeProviderTarget =
    providerReadiness.data?.firstReadyProvider ?? null;
  const isStartupLoading = isSessionsLoading || isCurrentSessionLoading || providerReadiness.loading;

  async function handleRenameSession(sessionId: string, title: string) {
    try {
      await renameSession(sessionId, title);
    } catch {
      // Keep chat flow moving even if the auto-title request fails.
    }
  }

  async function handleWelcomeSend(prompt: string) {
    if (providerSetupRequired) return;
    // Stash the pending prompt so the new chat surface picks it up on mount.
    // We use sessionStorage (not localStorage) so it never leaks across tabs.
    try {
      window.sessionStorage.setItem("monet.pendingPrompt", prompt);
    } catch {
      // Non-fatal — user can retype in the chat composer.
    }
    await createSession({ pathname: "/" });
  }

  // Welcome surface: no hydrated session detail OR the local workspace is still
  // starting up / blocked on provider setup.
  if (!currentSessionDetail) {
    const controllerOffline =
      controllerStateLabel === "failed" || controllerStateLabel === "stopped";
    const controllerBooting =
      controllerStateLabel === "starting" || controllerStateLabel === "restarting";
    const composerDisabled =
      providerSetupRequired || controllerOffline || controllerBooting;
    const composerDisabledReason = controllerOffline
      ? sanitizeInternalRuntimeMessage(controllerState?.message) ?? "Restart your local workspace to continue."
      : controllerBooting
        ? "Waiting for your local workspace…"
        : providerSetupRequired
          ? "Finish model setup to start chatting."
          : sessionsError ?? undefined;

    return (
      <PageFrame pathname="/" title="Chat" description="Your local agent workspace.">
        <WelcomeHome
          recentSessions={activeSessions}
          readyProviders={readyProviders}
          activeProviderTarget={activeProviderTarget}
          providerSetupRequired={providerSetupRequired}
          isStartupLoading={isStartupLoading}
          onOpenSession={(id) => openSession(id, "/")}
          onSend={handleWelcomeSend}
          isComposerDisabled={composerDisabled}
          {...(composerDisabledReason ? { composerDisabledReason } : {})}
          modelSettingsHref={modelSettingsHref}
        />

        {controllerOffline && isDesktop ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "calc(var(--spacing) * 4)" }}>
            <button
              type="button"
              className="session-action-button session-action-button-primary"
              onClick={() => void restartController()}
              disabled={restartPending}
            >
              {restartPending ? "Restarting workspace…" : "Restart workspace"}
            </button>
          </div>
        ) : null}

        {providerSetupRequired ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "calc(var(--spacing) * 4)" }}>
            <Link href={modelSettingsHref} className="session-action-button session-action-button-primary">
              Open model settings
            </Link>
          </div>
        ) : null}
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
