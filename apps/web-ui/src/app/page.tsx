"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Card } from "@nexu-design/ui-web";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";
import { DEFAULT_SESSION_TITLE, useSessions } from "../components/session-provider";
import { getMonetClientConfig } from "../lib/monet-client";
import type { SessionDetailRecord } from "../lib/session-api";

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
  const controllerConfig = getMonetClientConfig();
  const initialMessages = useMemo(() => session.messages.map((message) => message.uiMessage), [session.id]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${controllerConfig.apiBase}/api/chat`,
        headers: () => {
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
        }
      }),
    [controllerConfig.apiBase, controllerConfig.bearerToken, session.defaultModelId, session.defaultProviderId, session.id]
  );
  const { messages, sendMessage, regenerate, stop, status, error, clearError } = useChat({
    id: session.id,
    messages: initialMessages,
    transport,
    onFinish: async () => {
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

    setInput(value);
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
          hasError={error != null}
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
        <ChatThread messages={messages} status={status} errorText={error?.message} />
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
