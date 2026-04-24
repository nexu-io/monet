"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../components/page-frame";

import { useSessions } from "../../components/session-provider";

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
        <Card className="card stack">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Session browser</span>
              <CardTitle>Session history</CardTitle>
            </div>
            <CardDescription className="muted">
              Rename, archive, and inspect persisted session detail without leaving the static renderer shell.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sessionsError ? <p className="muted">{sessionsError}</p> : null}
            {isSessionsLoading ? <p className="muted">Loading sessions...</p> : null}
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
                      <span className="muted">{session.archivedAt ? "Archived" : "Active"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="card stack">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Selected session</span>
              <CardTitle>{currentSessionDetail?.title ?? "No session selected"}</CardTitle>
            </div>
            <CardDescription className="muted">
              {currentSessionDetail ? currentSessionDetail.id : "Pick a session from the list to inspect its persisted messages."}
            </CardDescription>
          </CardHeader>

          <CardContent className="stack-tight">
            {isCurrentSessionLoading ? <p className="muted">Loading session detail...</p> : null}
            {!isCurrentSessionLoading && !currentSessionDetail ? <p className="muted">Choose a session to inspect its detail.</p> : null}
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
