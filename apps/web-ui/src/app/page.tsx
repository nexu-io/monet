"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { PageFrame } from "../components/page-frame";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { sanitizeInternalRuntimeMessage } from "../components/workspace-copy";
import { useControllerState } from "../lib/controller-state";
import { getMonetClientConfig } from "../lib/monet-client";
import type { ProviderReadinessTarget } from "../lib/provider-readiness";
import type { SessionDetailRecord } from "../lib/session-api";

const primarySessionActionButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3.5 font-medium text-accent-foreground no-underline transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:border-[hsl(var(--accent)/0.92)] hover:bg-[hsl(var(--accent)/0.92)] focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";

function mergeHeaders(baseHeaders: Record<string, string>, headers: HeadersInit | undefined): Record<string, string> {
  const merged: Record<string, string> = { ...baseHeaders };

  if (!headers) {
    return merged;
  }

  new Headers(headers).forEach((value, key) => {
    merged[key] = value;
  });

  return merged;
}

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
  const resolvedControllerConfig = controllerConfig ?? getMonetClientConfig();
  const chatHeaders = useMemo<Record<string, string>>(
    () => {
      const headers: Record<string, string> = {};

      if (resolvedControllerConfig.bearerToken) {
        headers.Authorization = `Bearer ${resolvedControllerConfig.bearerToken}`;
      }

      return headers;
    },
    [resolvedControllerConfig.bearerToken]
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${resolvedControllerConfig.apiBase}/api/chat`,
        credentials: "omit",
        headers: chatHeaders,
        body: {
          sessionId: session.id,
          ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
          ...(resolvedModelId ? { modelId: resolvedModelId } : {})
        },
        prepareSendMessagesRequest: ({ api, id, messages, body, headers, credentials, trigger, messageId }) => {
          const pendingContinuation = pendingContinuationRef.current;
          const preparedBody = {
            ...body,
            id,
            messages,
            trigger,
            messageId
          };

          if (!pendingContinuation) {
            return {
              api,
              body: preparedBody,
              headers: mergeHeaders(chatHeaders, headers),
              credentials
            };
          }

          return {
            api: `${resolvedControllerConfig.apiBase}/api/runs/${pendingContinuation.runId}/continue`,
            headers: mergeHeaders(chatHeaders, headers),
            credentials,
            body: {
              ...preparedBody,
              ...pendingContinuation
            }
          };
        }
      }),
    [chatHeaders, resolvedControllerConfig.apiBase, resolvedModelId, resolvedProviderId, session.id]
  );
  const { messages, sendMessage, stop, status, error, clearError, addToolApprovalResponse } = useChat({
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

    setInput("");

    if (session.title === DEFAULT_SESSION_TITLE && !hasUserMessages) {
      await onRenameSession(session.id, deriveSessionTitle(text));
    }

    pendingContinuationRef.current = null;
    await sendMessage({ text });
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

    const response = await fetch(`${controllerConfig?.apiBase ?? "http://127.0.0.1:42831"}/api/tools/confirm`, {
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
          readyProviders={readyProviders}
          activeTarget={activeProviderTarget}
          isTargetOverridden={overrideProviderTarget !== null}
          onChangeTarget={handleChangeProviderTarget}
        />
      )}
      composer={(
        <Composer
          value={input}
          status={status}
          disabled={isComposerDisabled}
          {...(isComposerDisabled ? { disabledReason: composerDisabledReason } : {})}
          readyProviders={readyProviders}
          activeTarget={activeProviderTarget}
          isTargetOverridden={overrideProviderTarget !== null}
          onValueChange={handleInputChange}
          onSubmit={() => void handleSubmit()}
          onStop={handleStop}
          onChangeTarget={handleChangeProviderTarget}
        />
      )}
    >
      <div className="flex flex-col gap-6">
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

function EmptyChatConversation({
  activeProviderTarget,
  composerDisabledReason,
  isComposerDisabled,
  onCreateSession,
  readyProviders
}: {
  activeProviderTarget: ProviderReadinessTarget | null;
  composerDisabledReason?: string;
  isComposerDisabled: boolean;
  onCreateSession: (prompt: string, providerTarget: ProviderReadinessTarget | null) => Promise<void>;
  readyProviders: ProviderReadinessTarget[];
}) {
  const [input, setInput] = useState("");
  const [overrideProviderTarget, setOverrideProviderTarget] = useState<ProviderReadinessTarget | null>(null);
  const selectedProviderTarget = overrideProviderTarget ?? activeProviderTarget;

  function handleChangeProviderTarget(target: ProviderReadinessTarget | null) {
    if (
      target &&
      activeProviderTarget &&
      target.providerId === activeProviderTarget.providerId &&
      target.modelId === activeProviderTarget.modelId
    ) {
      setOverrideProviderTarget(null);
      return;
    }

    setOverrideProviderTarget(target);
  }

  async function handleSubmit() {
    const text = input.trim();

    if (!text || isComposerDisabled) {
      return;
    }

    setInput("");
    await onCreateSession(text, selectedProviderTarget);
  }

  return (
    <PageFrame
      pathname="/"
      title="Chat"
      description="Desktop-first chat shell wired to your local workspace with streaming AI SDK UI message rendering."
      header={(
        <ConversationHeader
          sessionTitle={DEFAULT_SESSION_TITLE}
          sessionId="new-chat"
          status="ready"
          messageCount={0}
          hasError={false}
          readyProviders={readyProviders}
          activeTarget={selectedProviderTarget}
          isTargetOverridden={overrideProviderTarget !== null}
          onChangeTarget={handleChangeProviderTarget}
        />
      )}
      composer={(
        <Composer
          value={input}
          status="ready"
          disabled={isComposerDisabled}
          {...(isComposerDisabled && composerDisabledReason ? { disabledReason: composerDisabledReason } : {})}
          readyProviders={readyProviders}
          activeTarget={selectedProviderTarget}
          isTargetOverridden={overrideProviderTarget !== null}
          onValueChange={setInput}
          onSubmit={() => void handleSubmit()}
          onStop={() => undefined}
          onChangeTarget={handleChangeProviderTarget}
        />
      )}
    >
      <div className="flex flex-col gap-6">
        <ChatThread
          messages={[]}
          status="ready"
          errorText={undefined}
          isArchived={false}
          onToolApproval={async () => {
            throw new Error("Tool confirmation is unavailable before a chat starts.");
          }}
        />
      </div>
    </PageFrame>
  );
}

/**
 * Home route.
 *
 * Two visual states:
 *   - Empty chat: no active session selected → classic conversation shell with
 *     an empty thread and composer.
 *   - Chat: an active session detail is loaded → classic conversation surface
 *     with header, streaming thread, and composer.
 */
export default function HomePage() {
  const { controllerState, isDesktop, restartController, restartPending } = useControllerState();
  const {
    createSession,
    currentSessionDetail,
    providerReadiness,
    refreshCurrentSession,
    refreshSessions,
    renameSession,
    sessionsError
  } = useSessions();

  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const controllerStateLabel = controllerState?.state;
  const readyProviders = providerReadiness.data?.readyProviders ?? [];
  const activeProviderTarget =
    providerReadiness.data?.firstReadyProvider ?? null;

  async function handleRenameSession(sessionId: string, title: string) {
    try {
      await renameSession(sessionId, title);
    } catch {
      // Keep chat flow moving even if the auto-title request fails.
    }
  }

  async function handleEmptyChatSend(prompt: string, providerTarget: ProviderReadinessTarget | null) {
    if (providerSetupRequired) return;
    // Stash the pending prompt so the new chat surface picks it up on mount.
    // We use sessionStorage (not localStorage) so it never leaks across tabs.
    try {
      window.sessionStorage.setItem("monet.pendingPrompt", prompt);
    } catch {
      // Non-fatal — user can retype in the chat composer.
    }
    await createSession({
      pathname: "/",
      ...(providerTarget ? { providerId: providerTarget.providerId, modelId: providerTarget.modelId } : {})
    });
  }

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
      <>
        <EmptyChatConversation
          readyProviders={readyProviders}
          activeProviderTarget={activeProviderTarget}
          isComposerDisabled={composerDisabled}
          {...(composerDisabledReason ? { composerDisabledReason } : {})}
          onCreateSession={handleEmptyChatSend}
        />

        {controllerOffline && isDesktop ? (
          <div className="fixed right-6 bottom-6 z-10">
            <button
              type="button"
              className={primarySessionActionButtonClassName}
              onClick={() => void restartController()}
              disabled={restartPending}
            >
              {restartPending ? "Restarting workspace…" : "Restart workspace"}
            </button>
          </div>
        ) : null}

        {providerSetupRequired ? (
          <div className="fixed right-6 bottom-6 z-10">
            <Link to="/settings/models" className={primarySessionActionButtonClassName}>
              Open model settings
            </Link>
          </div>
        ) : null}
      </>
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
