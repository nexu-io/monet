"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexu-design/ui-web";

import { PageFrame } from "../../components/page-frame";

import { useSessions } from "../../components/session-provider";

const sessionSurfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-xs flex flex-col gap-3";
const sessionItemClassName =
  "flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-3 text-left text-inherit transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:border-border-strong focus-visible:outline-none focus-visible:shadow-focus data-[active=true]:border-[hsl(var(--accent)/0.4)] data-[active=true]:bg-[hsl(var(--accent)/0.06)]";
const sessionActionButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-surface-1 px-3.5 font-medium text-text-primary no-underline transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus";

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
      <section className="grid grid-cols-[minmax(0,calc(var(--spacing)*72))_minmax(0,1fr)] gap-4 max-app:grid-cols-1">
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
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {sessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={sessionItemClassName}
                      data-active={isActive ? "true" : "false"}
                      onClick={() => openSession(session.id, "/sessions")}
                    >
                      <span className="font-semibold text-text-heading">{session.title}</span>
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
                <div className="flex flex-wrap gap-2">
                  <Link href={buildSessionHref("/", currentSessionDetail.id)} className={sessionActionButtonClassName}>
                    Open in chat
                  </Link>
                  <button type="button" className={sessionActionButtonClassName} onClick={() => void handleRenameSession()}>
                    Rename
                  </button>
                  <button type="button" className={sessionActionButtonClassName} onClick={() => void handleArchiveSession()}>
                    Archive
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span>Status: {currentSessionDetail.archivedAt ? "Archived" : "Active"}</span>
                  <span>Messages: {currentSessionDetail.messages.length}</span>
                </div>

                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {currentSessionDetail.messages.map((message) => (
                    <li key={message.id} className="flex w-full flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-3 text-left text-inherit">
                      <strong>{message.role}</strong>
                      <p className="m-0 text-text-secondary">{extractMessagePreview(message.uiMessage)}</p>
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
