"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../components/page-frame";

import { useSessions } from "../../components/session-provider";

const sessionSurfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-xs flex flex-col gap-3";

function extractMessagePreview(value: unknown) {
  if (!value || typeof value !== "object") {
    return "No message preview available.";
  }

  const candidate = value as { parts?: Array<{ type?: string; text?: string }> };
  const textPart = candidate.parts?.find((part) => part.type === "text" && typeof part.text === "string");

  return textPart?.text ?? "No text parts in this message.";
}

export default function SessionsPage() {
  const { archiveSession, buildSessionHref, currentSessionDetail, currentSessionId, isCurrentSessionLoading, isSessionsLoading, openSession, renameSession, sessions, sessionsError } = useSessions();

  async function handleRenameSession() {
    if (!currentSessionDetail) {
      return;
    }

    const nextTitle = window.prompt("Rename session", currentSessionDetail.title)?.trim();

    if (!nextTitle || nextTitle === currentSessionDetail.title) {
      return;
    }

    await renameSession(currentSessionDetail.id, nextTitle);
  }

  async function handleArchiveSession() {
    if (!currentSessionDetail || !window.confirm(`Archive \"${currentSessionDetail.title}\"?`)) {
      return;
    }

    await archiveSession(currentSessionDetail.id);
  }

  return (
    <PageFrame
      pathname="/sessions"
      title="Sessions"
      description="Browse, rename, and archive your saved chat sessions."
    >
      <section className="session-browser-layout">
        <Card className={sessionSurfaceCardClassName}>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Session browser</span>
              <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Session history</CardTitle>
            </div>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">
              Rename, archive, and inspect persisted session detail without leaving the static renderer shell.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sessionsError ? <p className="m-0 leading-[1.5] text-text-muted">{sessionsError}</p> : null}
            {isSessionsLoading ? <p className="m-0 leading-[1.5] text-text-muted">Loading sessions...</p> : null}
            <ul className="session-browser-list">
              {sessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className="session-browser-item"
                      data-active={isActive ? "true" : "false"}
                      onClick={() => openSession(session.id, "/sessions")}
                    >
                      <span className="session-browser-item-title">{session.title}</span>
                      <span className="m-0 leading-[1.5] text-text-muted">{session.archivedAt ? "Archived" : "Active"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className={sessionSurfaceCardClassName}>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected session</span>
              <CardTitle className="m-0 text-2xl font-semibold text-text-heading">{currentSessionDetail?.title ?? "No session selected"}</CardTitle>
            </div>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">
              {currentSessionDetail ? currentSessionDetail.id : "Pick a session from the list to inspect its persisted messages."}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-1">
            {isCurrentSessionLoading ? <p className="m-0 leading-[1.5] text-text-muted">Loading session detail...</p> : null}
            {!isCurrentSessionLoading && !currentSessionDetail ? <p className="m-0 leading-[1.5] text-text-muted">Choose a session to inspect its detail.</p> : null}
            {currentSessionDetail ? (
              <>
                <div className="session-browser-actions">
                  <Link href={buildSessionHref("/", currentSessionDetail.id)} className="session-action-button">
                    Open in chat
                  </Link>
                  <button type="button" className="session-action-button" onClick={() => void handleRenameSession()}>
                    Rename
                  </button>
                  <button type="button" className="session-action-button" onClick={() => void handleArchiveSession()}>
                    Archive
                  </button>
                </div>

                <div className="session-detail-meta">
                  <span>Status: {currentSessionDetail.archivedAt ? "Archived" : "Active"}</span>
                  <span>Messages: {currentSessionDetail.messages.length}</span>
                </div>

                <ul className="session-detail-message-list">
                  {currentSessionDetail.messages.map((message) => (
                    <li key={message.id} className="session-detail-message">
                      <strong>{message.role}</strong>
                      <p>{extractMessagePreview(message.uiMessage)}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </PageFrame>
  );
}
