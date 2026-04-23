"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  archiveSession as archiveSessionRequest,
  createSession as createSessionRequest,
  DEFAULT_SESSION_TITLE,
  getSessionDetail,
  listSessions,
  renameSession as renameSessionRequest,
  type SessionDetailRecord,
  type SessionRecord
} from "../lib/session-api";

const SESSION_QUERY_PARAM = "session";

interface SessionContextValue {
  readonly sessions: SessionRecord[];
  readonly currentSessionId: string | null;
  readonly currentSession: SessionRecord | null;
  readonly currentSessionDetail: SessionDetailRecord | null;
  readonly sessionsError: string | null;
  readonly isSessionsLoading: boolean;
  readonly isCurrentSessionLoading: boolean;
  readonly createSession: (options?: { pathname?: string }) => Promise<SessionRecord>;
  readonly openSession: (sessionId: string, pathname?: string) => void;
  readonly buildSessionHref: (pathname: string, sessionId: string | null) => string;
  readonly refreshSessions: () => Promise<void>;
  readonly refreshCurrentSession: () => Promise<void>;
  readonly renameSession: (sessionId: string, title: string) => Promise<SessionRecord>;
  readonly archiveSession: (sessionId: string) => Promise<SessionRecord>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function sortSessions(sessions: SessionRecord[]) {
  return [...sessions].sort((left, right) => {
    if (left.archivedAt === null && right.archivedAt !== null) {
      return -1;
    }

    if (left.archivedAt !== null && right.archivedAt === null) {
      return 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt);
  });
}

function upsertSession(sessions: SessionRecord[], nextSession: SessionRecord) {
  return sortSessions([...sessions.filter((session) => session.id !== nextSession.id), nextSession]);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSessionId = searchParams.get(SESSION_QUERY_PARAM);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [currentSessionDetail, setCurrentSessionDetail] = useState<SessionDetailRecord | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isSessionsLoading, setIsSessionsLoading] = useState(true);
  const [isCurrentSessionLoading, setIsCurrentSessionLoading] = useState(false);

  function buildSessionHref(targetPathname: string, sessionId: string | null) {
    const params = new URLSearchParams(searchParams.toString());

    if (sessionId) {
      params.set(SESSION_QUERY_PARAM, sessionId);
    } else {
      params.delete(SESSION_QUERY_PARAM);
    }

    const query = params.toString();

    return query ? `${targetPathname}?${query}` : targetPathname;
  }

  function openSession(sessionId: string, targetPathname = pathname) {
    startTransition(() => {
      router.push(buildSessionHref(targetPathname, sessionId));
    });
  }

  async function refreshSessions() {
    setIsSessionsLoading(true);

    try {
      const response = await listSessions();

      setSessions(sortSessions(response.sessions));
      setSessionsError(null);
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Failed to load sessions.");
    } finally {
      setIsSessionsLoading(false);
    }
  }

  async function refreshCurrentSession() {
    if (!currentSessionId) {
      setCurrentSessionDetail(null);
      setIsCurrentSessionLoading(false);
      return;
    }

    setIsCurrentSessionLoading(true);

    try {
      const detail = await getSessionDetail(currentSessionId);

      setCurrentSessionDetail(detail);
      setSessions((current) => upsertSession(current, detail));
      setSessionsError(null);
    } catch (error) {
      setCurrentSessionDetail(null);
      setSessionsError(error instanceof Error ? error.message : "Failed to load the selected session.");
    } finally {
      setIsCurrentSessionLoading(false);
    }
  }

  async function createSession(options?: { pathname?: string }) {
    const session = await createSessionRequest();

    setSessions((current) => upsertSession(current, session));
    setCurrentSessionDetail({
      ...session,
      messages: []
    });
    setSessionsError(null);
    openSession(session.id, options?.pathname ?? "/");

    return session;
  }

  async function renameSession(sessionId: string, title: string) {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      throw new Error("Session title cannot be empty.");
    }

    const session = await renameSessionRequest(sessionId, trimmedTitle);

    setSessions((current) => upsertSession(current, session));
    setCurrentSessionDetail((current) => (current?.id === session.id ? { ...current, ...session } : current));
    setSessionsError(null);

    return session;
  }

  async function archiveSession(sessionId: string) {
    const response = await archiveSessionRequest(sessionId);
    const session = response.session;

    setSessions((current) => upsertSession(current, session));
    setCurrentSessionDetail((current) => (current?.id === session.id ? { ...current, ...session } : current));
    setSessionsError(null);

    if (sessionId === currentSessionId && pathname === "/") {
      const nextSession = sessions.find((candidate) => candidate.id !== sessionId && candidate.archivedAt === null) ?? null;
      startTransition(() => {
        router.replace(buildSessionHref(pathname, nextSession?.id ?? null));
      });
    }

    return session;
  }

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    void refreshCurrentSession();
  }, [currentSessionId]);

  useEffect(() => {
    if (!currentSessionId && (pathname === "/" || pathname === "/sessions")) {
      const nextSession = sessions.find((session) => session.archivedAt === null) ?? null;

      if (nextSession) {
        startTransition(() => {
          router.replace(buildSessionHref(pathname, nextSession.id));
        });
      }
    }
  }, [currentSessionId, pathname, router, searchParams, sessions]);

  const currentSession = currentSessionDetail ?? sessions.find((session) => session.id === currentSessionId) ?? null;
  const value = useMemo<SessionContextValue>(
    () => ({
      sessions,
      currentSessionId,
      currentSession,
      currentSessionDetail,
      sessionsError,
      isSessionsLoading,
      isCurrentSessionLoading,
      createSession,
      openSession,
      buildSessionHref,
      refreshSessions,
      refreshCurrentSession,
      renameSession,
      archiveSession
    }),
    [currentSession, currentSessionDetail, currentSessionId, isCurrentSessionLoading, isSessionsLoading, sessions, sessionsError]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessions() {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSessions must be used within SessionProvider.");
  }

  return value;
}

export { DEFAULT_SESSION_TITLE };
