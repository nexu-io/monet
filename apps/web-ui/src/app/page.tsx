"use client";

import { useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { Card } from "@nexu-design/ui-web";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { getMonetClientConfig } from "../lib/monet-client";
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
  onRenameSession,
  onRefreshCurrentSession,
  onRefreshSessions
}: {
  session: SessionDetailRecord;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onRefreshCurrentSession: () => Promise<void>;
  onRefreshSessions: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [approvalErrorText, setApprovalErrorText] = useState<string | undefined>(undefined);
  const pendingContinuationRef = useRef<PendingContinuationRequest | null>(null);
  const controllerConfig = getMonetClientConfig();
  const initialMessages = useMemo(() => session.messages.map((message) => message.uiMessage), [session.id, session.messages]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${controllerConfig.apiBase}/api/chat`,
        credentials: "omit",
        headers: (): Record<string, string> => {
          if (!controllerConfig.bearerToken) {
            return {};
          }

          return {
            Authorization: `Bearer ${controllerConfig.bearerToken}`
          };
        },
        body: {
          sessionId: session.id,
          providerId: session.defaultProviderId ?? "pro_b6m4q2r8t5v9x3z7k1n4p6s8",
          modelId: session.defaultModelId ?? "mod_c7n5r3t9w2y6k4m8p1s5v7x9"
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
            api: `${controllerConfig.apiBase}/api/runs/${pendingContinuation.runId}/continue`,
            headers,
            credentials,
            body: {
              ...body,
              ...pendingContinuation
            }
          };
        }
      }),
    [controllerConfig.apiBase, controllerConfig.bearerToken, session.defaultModelId, session.defaultProviderId, session.id]
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

  async function handleSubmit() {
    const text = input.trim();

    if (!text || isBusy || isArchived) {
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
    if (!canRegenerate || isArchived) {
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
    if (isBusy || isArchived) {
      return;
    }

    setApprovalErrorText(undefined);

    const headers = new Headers({
      "content-type": "application/json"
    });

    if (controllerConfig.bearerToken) {
      headers.set("Authorization", `Bearer ${controllerConfig.bearerToken}`);
    }

    const response = await fetch(`${controllerConfig.apiBase}/api/tools/confirm`, {
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
      return;
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
      header={(
        <ConversationHeader
          sessionTitle={session.title}
          sessionId={session.id}
          status={status}
          messageCount={messages.length}
          hasError={error != null || approvalErrorText != null}
          canRegenerate={canRegenerate}
          onRegenerate={() => void handleRegenerate()}
          onStop={handleStop}
        />
      )}
      composer={(
        <Composer
          value={input}
          status={status}
          canRegenerate={canRegenerate}
          disabled={isArchived}
          {...(isArchived
            ? {
                disabledReason: "This session is archived. Create a new session or switch to an active one to continue chatting."
              }
            : {})}
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
          onToolApproval={(request) => void handleToolApproval(request)}
        />
      </div>
    </PageFrame>
  );
}

export default function HomePage() {
  const { createSession, currentSessionDetail, isCurrentSessionLoading, isSessionsLoading, refreshCurrentSession, refreshSessions, renameSession, sessionsError } = useSessions();

  async function handleRenameSession(sessionId: string, title: string) {
    try {
      await renameSession(sessionId, title);
    } catch {
      // Keep chat flow moving even if the auto-title request fails.
    }
  }

  if (!currentSessionDetail) {
    return (
      <PageFrame
        pathname="/"
        title="Agent Chat"
        description="Desktop-first chat shell wired for a local Hono controller and ready for AI SDK UI message rendering."
      >
        <Card className="card stack-tight session-browser-empty">
          <span className="eyebrow">Session state</span>
          <strong>{isSessionsLoading || isCurrentSessionLoading ? "Loading session history..." : "No active session selected."}</strong>
          <p className="muted">{sessionsError ?? "Create a fresh session to start streaming against the persisted controller-backed chat flow."}</p>
          <div>
            <button type="button" className="session-action-button session-action-button-primary" onClick={() => void createSession({ pathname: "/" })}>
              Create session
            </button>
          </div>
        </Card>
      </PageFrame>
    );
  }

  return (
    <SessionChatSurface
      key={currentSessionDetail.id}
      session={currentSessionDetail}
      onRenameSession={handleRenameSession}
      onRefreshCurrentSession={refreshCurrentSession}
      onRefreshSessions={refreshSessions}
    />
  );
}
