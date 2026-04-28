"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { ExternalLink, RefreshCw, X } from "lucide-react";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ArtifactHtmlFrame } from "../components/live-artifacts/artifact-html-frame";
import { PageFrame } from "../components/page-frame";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { sanitizeInternalRuntimeMessage } from "../components/workspace-copy";
import { useControllerState } from "../lib/controller-state";
import { PENDING_CHAT_PROMPT_STORAGE_KEY, stashPendingChatPrompt } from "../lib/chat-prompt-seed";
import { getMonetClientConfig } from "../lib/monet-client";
import { getLiveArtifact, type LiveArtifact } from "../lib/live-artifacts-api";
import { fetchProviderTargets, type ProviderReadinessTarget } from "../lib/provider-readiness";
import type { SessionDetailRecord } from "../lib/session-api";
import { Button } from "@nexu-design/ui-web";

const primarySessionActionButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3.5 font-medium text-accent-foreground no-underline transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:border-[hsl(var(--accent)/0.92)] hover:bg-[hsl(var(--accent)/0.92)] focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";

type ArtifactPanelLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly artifact: LiveArtifact };

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

function LiveArtifactSidePanel({ artifactId, onClose }: { readonly artifactId: string; readonly onClose: () => void }) {
  const [loadState, setLoadState] = useState<ArtifactPanelLoadState>({ status: "idle" });

  const loadArtifact = useCallback(async () => {
    setLoadState({ status: "loading" });

    try {
      const response = await getLiveArtifact(artifactId);
      setLoadState({ status: "loaded", artifact: response.artifact });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load live artifact."
      });
    }
  }, [artifactId]);

  useEffect(() => {
    void loadArtifact();
  }, [loadArtifact]);

  const artifactTitle = loadState.status === "loaded" ? loadState.artifact.title : "Live artifact";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-dropdown" aria-label="Live artifact preview">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-1 px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate font-heading text-lg font-semibold tracking-[-0.01em] text-text-heading">{artifactTitle}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="ghost" size="icon" title="Open full page" aria-label="Open full page" onClick={() => window.open(`/artifacts/${encodeURIComponent(artifactId)}`, "_blank", "noopener,noreferrer")}>
            <ExternalLink aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Button>
          <Button type="button" variant="ghost" size="icon" title="Reload" aria-label="Reload" disabled={loadState.status === "loading"} onClick={() => void loadArtifact()}>
            <RefreshCw aria-hidden="true" className={loadState.status === "loading" ? "size-4 animate-spin" : "size-4"} strokeWidth={1.8} />
          </Button>
          <Button type="button" variant="ghost" size="icon" title="Close" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-app-canvas">
        {loadState.status === "idle" || loadState.status === "loading" ? (
          <div className="flex h-full flex-col gap-4 p-5" aria-live="polite" aria-label="Loading artifact">
            <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="h-20 w-full animate-pulse rounded-xl bg-surface-2" />
            <div className="h-72 w-full animate-pulse rounded-xl bg-surface-2" />
          </div>
        ) : loadState.status === "error" ? (
          <div className="m-5 rounded-xl border border-warning/20 bg-warning-subtle p-4 text-sm text-warning">
            <p className="m-0 font-semibold">Unable to load artifact.</p>
            <p className="m-0 mt-1">{loadState.message}</p>
          </div>
        ) : loadState.artifact.document ? (
          <ArtifactHtmlFrame document={loadState.artifact.document} title={loadState.artifact.title} />
        ) : (
          <div className="m-5 rounded-xl border border-border-subtle bg-surface-1 p-4 text-sm text-text-muted">
            This artifact has no renderable content yet.
          </div>
        )}
      </div>
    </aside>
  );
}

interface PendingContinuationRequest {
  readonly runId: string;
  readonly toolCallId: string;
  readonly decision: "approved" | "rejected";
  readonly confirmationToken: string;
}

const SELECTED_PROVIDER_TARGET_STORAGE_KEY = "monet.chat.selectedProviderTarget";

type StoredProviderTarget = Pick<ProviderReadinessTarget, "providerId" | "modelId">;

function getTargetStorageKey(target: StoredProviderTarget) {
  return `${target.providerId}::${target.modelId}`;
}

function getStoredProviderTarget(): StoredProviderTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(SELECTED_PROVIDER_TARGET_STORAGE_KEY);

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as Partial<StoredProviderTarget>;

    return typeof parsed.providerId === "string" && typeof parsed.modelId === "string"
      ? { providerId: parsed.providerId, modelId: parsed.modelId }
      : null;
  } catch {
    return null;
  }
}

function storeProviderTarget(target: ProviderReadinessTarget | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!target) {
      window.localStorage.removeItem(SELECTED_PROVIDER_TARGET_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      SELECTED_PROVIDER_TARGET_STORAGE_KEY,
      JSON.stringify({ providerId: target.providerId, modelId: target.modelId } satisfies StoredProviderTarget)
    );
  } catch {
    // Non-fatal: model routing still works without web storage.
  }
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
  onRememberProviderTarget,
  readyProviders,
  onRenameSession,
  onRefreshCurrentSession,
  onRefreshSessions
}: {
  session: SessionDetailRecord;
  fallbackProviderTarget: ProviderReadinessTarget | null;
  onRememberProviderTarget: (target: ProviderReadinessTarget | null) => void;
  readyProviders: ProviderReadinessTarget[];
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onRefreshCurrentSession: () => Promise<void>;
  onRefreshSessions: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [approvalErrorText, setApprovalErrorText] = useState<string | undefined>(undefined);
  const [overrideProviderTarget, setOverrideProviderTarget] = useState<ProviderReadinessTarget | null>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
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
  const isComposerDisabled = isArchived;
  const composerDisabledReason = isArchived
    ? "This session is archived. Create a new session or switch to an active one to continue chatting."
    : undefined;

  useEffect(() => {
    setInput("");
    setApprovalErrorText(undefined);
    setOverrideProviderTarget(null);
    setOpenArtifactId(null);
    pendingContinuationRef.current = null;
    clearError();
  }, [clearError, session.id]);

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

    const pending = window.sessionStorage.getItem(PENDING_CHAT_PROMPT_STORAGE_KEY);
    if (!pending) return;

    window.sessionStorage.removeItem(PENDING_CHAT_PROMPT_STORAGE_KEY);

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
    onRememberProviderTarget(target);

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

  const chatThread = (
    <ChatThread
      messages={messages}
      status={status}
      errorText={approvalErrorText ?? error?.message}
      isArchived={isArchived}
      onToolApproval={handleToolApproval}
      openArtifactId={openArtifactId}
      onOpenArtifact={setOpenArtifactId}
    />
  );
  const composer = (
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
  );

  return (
    <PageFrame
      pathname="/"
      title="Chat"
      description="Desktop-first chat shell wired to your local workspace with streaming AI SDK UI message rendering."
      onDesktopStopShortcut={handleStop}
      header={false}
      contentClassName={openArtifactId ? "overflow-hidden" : "pt-12"}
      contentWrapper={openArtifactId ? "none" : undefined}
      composer={openArtifactId ? undefined : composer}
    >
      {openArtifactId ? (
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] gap-4 pl-[var(--app-page-padding-x)] pr-4 pt-4 pb-4 max-[1180px]:grid-cols-1 max-[1180px]:px-[var(--app-page-padding-x)]">
          <div className="mx-auto grid h-full min-h-0 w-full max-w-[var(--app-content-max-width)] grid-rows-[minmax(0,1fr)_auto] pt-8">
            <div className="min-h-0 overflow-auto" data-chat-scroll-container="true">
              <div className="flex flex-col gap-6 pb-4">
                {chatThread}
              </div>
            </div>
            <div className="z-10 bg-app-canvas">
              {composer}
            </div>
          </div>
          <LiveArtifactSidePanel artifactId={openArtifactId} onClose={() => setOpenArtifactId(null)} />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {chatThread}
        </div>
      )}
    </PageFrame>
  );
}

function EmptyChatConversation({
  activeProviderTarget,
  composerDisabledReason,
  isComposerDisabled,
  onRememberProviderTarget,
  onCreateSession,
  readyProviders
}: {
  activeProviderTarget: ProviderReadinessTarget | null;
  composerDisabledReason?: string;
  isComposerDisabled: boolean;
  onRememberProviderTarget: (target: ProviderReadinessTarget | null) => void;
  onCreateSession: (prompt: string, providerTarget: ProviderReadinessTarget | null) => Promise<void>;
  readyProviders: ProviderReadinessTarget[];
}) {
  const [input, setInput] = useState("");
  const [overrideProviderTarget, setOverrideProviderTarget] = useState<ProviderReadinessTarget | null>(null);
  const selectedProviderTarget = overrideProviderTarget ?? activeProviderTarget;

  function handleChangeProviderTarget(target: ProviderReadinessTarget | null) {
    onRememberProviderTarget(target);

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
      header={false}
      contentClassName="pt-12"
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
    refreshCurrentSession,
    refreshSessions,
    renameSession,
    sessionsError
  } = useSessions();
  const [providerTargets, setProviderTargets] = useState<ProviderReadinessTarget[]>([]);
  const [storedProviderTarget, setStoredProviderTarget] = useState<StoredProviderTarget | null>(() => getStoredProviderTarget());

  const controllerStateLabel = controllerState?.state;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const targets = await fetchProviderTargets();

        if (!cancelled) {
          setProviderTargets(targets);
        }
      } catch {
        if (!cancelled) {
          setProviderTargets([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rememberedProviderTarget = storedProviderTarget
    ? providerTargets.find((target) => getTargetStorageKey(target) === getTargetStorageKey(storedProviderTarget)) ?? null
    : null;
  const defaultProviderTarget = rememberedProviderTarget ?? providerTargets[0] ?? null;

  useEffect(() => {
    if (!storedProviderTarget || providerTargets.length === 0) {
      return;
    }

    const isStoredTargetReady = providerTargets.some((target) => getTargetStorageKey(target) === getTargetStorageKey(storedProviderTarget));

    if (!isStoredTargetReady) {
      setStoredProviderTarget(null);
      storeProviderTarget(null);
    }
  }, [providerTargets, storedProviderTarget]);

  const rememberProviderTarget = useCallback((target: ProviderReadinessTarget | null) => {
    const nextTarget = target ? { providerId: target.providerId, modelId: target.modelId } : null;
    setStoredProviderTarget(nextTarget);
    storeProviderTarget(target);
  }, []);

  async function handleRenameSession(sessionId: string, title: string) {
    try {
      await renameSession(sessionId, title);
    } catch {
      // Keep chat flow moving even if the auto-title request fails.
    }
  }

  async function handleEmptyChatSend(prompt: string, providerTarget: ProviderReadinessTarget | null) {
    // Stash the pending prompt so the new chat surface picks it up on mount.
    // We use sessionStorage (not localStorage) so it never leaks across tabs.
    try {
      stashPendingChatPrompt(prompt);
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
      controllerOffline || controllerBooting;
    const composerDisabledReason = controllerOffline
      ? sanitizeInternalRuntimeMessage(controllerState?.message) ?? "Restart your local workspace to continue."
      : controllerBooting
        ? "Waiting for your local workspace…"
        : sessionsError ?? undefined;

    return (
      <>
        <EmptyChatConversation
          readyProviders={providerTargets}
          activeProviderTarget={defaultProviderTarget}
          isComposerDisabled={composerDisabled}
          {...(composerDisabledReason ? { composerDisabledReason } : {})}
          onRememberProviderTarget={rememberProviderTarget}
          onCreateSession={handleEmptyChatSend}
        />

        {controllerOffline && isDesktop ? (
          <div className="fixed right-6 bottom-6 z-10">
            <Button
              variant="primary"
              type="button"
              className={primarySessionActionButtonClassName}
              onClick={() => void restartController()}
              disabled={restartPending}
            >
              {restartPending ? "Restarting workspace…" : "Restart workspace"}
            </Button>
          </div>
        ) : null}

      </>
    );
  }

  const fallbackProviderTarget = rememberedProviderTarget ?? (currentSessionDetail.defaultProviderId && currentSessionDetail.defaultModelId
    ? providerTargets.find(
        (target) => target.providerId === currentSessionDetail.defaultProviderId && target.modelId === currentSessionDetail.defaultModelId
      ) ?? {
        providerId: currentSessionDetail.defaultProviderId,
        modelId: currentSessionDetail.defaultModelId,
        providerDisplayName: "Default provider",
        modelName: null
      }
    : defaultProviderTarget);

  return (
    <SessionChatSurface
      session={currentSessionDetail}
      readyProviders={providerTargets}
      fallbackProviderTarget={fallbackProviderTarget}
      onRememberProviderTarget={rememberProviderTarget}
      onRenameSession={handleRenameSession}
      onRefreshCurrentSession={refreshCurrentSession}
      onRefreshSessions={refreshSessions}
    />
  );
}
