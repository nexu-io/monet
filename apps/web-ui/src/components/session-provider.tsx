"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { fetchProviderReadiness, PROVIDER_READINESS_EVENT, type ProviderReadinessSnapshot } from "../lib/provider-readiness";

const SESSION_QUERY_PARAM = "session";

interface ProviderReadinessState {
  readonly loading: boolean;
  readonly data: ProviderReadinessSnapshot | null;
  readonly error: string | null;
}

interface SessionContextValue {
  readonly sessions: SessionRecord[];
  readonly currentSessionId: string | null;
  readonly currentSession: SessionRecord | null;
  readonly currentSessionDetail: SessionDetailRecord | null;
  readonly sessionsError: string | null;
  readonly isSessionsLoading: boolean;
  readonly isCurrentSessionLoading: boolean;
  readonly providerReadiness: ProviderReadinessState;
  readonly createSession: (options?: { pathname?: string }) => Promise<SessionRecord>;
  readonly openSession: (sessionId: string, pathname?: string) => void;
  readonly buildSessionHref: (pathname: string, sessionId: string | null) => string;
  readonly refreshSessions: () => Promise<void>;
  readonly refreshCurrentSession: () => Promise<void>;
  readonly refreshProviderReadiness: () => Promise<void>;
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
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadinessState>({
    loading: true,
    data: null,
    error: null
  });
  const hasForcedProviderSetupRef = useRef(false);
  const latestSessionDetailRequestIdRef = useRef(0);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);

  currentSessionIdRef.current = currentSessionId;

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
    const requestSessionId = currentSessionId;
    const requestId = latestSessionDetailRequestIdRef.current + 1;
    latestSessionDetailRequestIdRef.current = requestId;

    if (!requestSessionId) {
      setCurrentSessionDetail(null);
      setIsCurrentSessionLoading(false);
      return;
    }

    setIsCurrentSessionLoading(true);

    try {
      const detail = await getSessionDetail(requestSessionId);

      if (latestSessionDetailRequestIdRef.current !== requestId || currentSessionIdRef.current !== requestSessionId) {
        return;
      }

      setCurrentSessionDetail(detail);
      setSessions((current) => upsertSession(current, detail));
      setSessionsError(null);
    } catch (error) {
      if (latestSessionDetailRequestIdRef.current !== requestId || currentSessionIdRef.current !== requestSessionId) {
        return;
      }

      setCurrentSessionDetail(null);
      setSessionsError(error instanceof Error ? error.message : "Failed to load the selected session.");
    } finally {
      if (latestSessionDetailRequestIdRef.current === requestId && currentSessionIdRef.current === requestSessionId) {
        setIsCurrentSessionLoading(false);
      }
    }
  }

  async function refreshProviderReadiness() {
    setProviderReadiness((current) => ({
      loading: true,
      data: current.data,
      error: null
    }));

    try {
      setProviderReadiness({
        loading: false,
        data: await fetchProviderReadiness(),
        error: null
      });
    } catch (error) {
      setProviderReadiness({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to load provider readiness."
      });
    }
  }

  async function createSession(options?: { pathname?: string }) {
    const readyProvider = providerReadiness.data?.firstReadyProvider;
    const session = await createSessionRequest(
      readyProvider
        ? {
            providerId: readyProvider.providerId,
            modelId: readyProvider.modelId
          }
        : undefined
    );

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
    void refreshProviderReadiness();
  }, []);

  useEffect(() => {
    function handleProviderReadinessUpdate() {
      void refreshProviderReadiness();
    }

    window.addEventListener(PROVIDER_READINESS_EVENT, handleProviderReadinessUpdate);

    return () => {
      window.removeEventListener(PROVIDER_READINESS_EVENT, handleProviderReadinessUpdate);
    };
  }, []);

  useEffect(() => {
    void refreshCurrentSession();
  }, [currentSessionId]);

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/sessions") {
      return;
    }

    if (isSessionsLoading || providerReadiness.loading) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    const shouldForceProviderSetup = !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;

    if (providerReadiness.data?.hasReadyProvider) {
      hasForcedProviderSetupRef.current = false;
    }

    if (shouldForceProviderSetup && !hasForcedProviderSetupRef.current) {
      hasForcedProviderSetupRef.current = true;
      startTransition(() => {
        router.replace("/settings/models");
      });
      return;
    }
    if (!currentSessionId) {
      const nextSession = sessions.find((session) => session.archivedAt === null) ?? null;

      if (nextSession) {
        params.set(SESSION_QUERY_PARAM, nextSession.id);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }, [currentSessionId, isSessionsLoading, pathname, providerReadiness.data, providerReadiness.error, providerReadiness.loading, router, searchParams, sessions]);

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
      providerReadiness,
      createSession,
      openSession,
      buildSessionHref,
      refreshSessions,
      refreshCurrentSession,
      refreshProviderReadiness,
      renameSession,
      archiveSession
    }),
    [currentSession, currentSessionDetail, currentSessionId, isCurrentSessionLoading, isSessionsLoading, providerReadiness, sessions, sessionsError]
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
