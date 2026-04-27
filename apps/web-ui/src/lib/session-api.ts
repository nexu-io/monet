import type { UIMessage } from "ai";

import { getMonetClientConfig } from "./monet-client";

export const DEFAULT_SESSION_TITLE = "New chat";

export interface SessionRecord {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly defaultProviderId: string | null;
  readonly defaultModelId: string | null;
}

export interface SessionMessageRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly runId: string | null;
  readonly role: string;
  readonly createdAt: string;
  readonly uiMessage: UIMessage;
}

export interface SessionDetailRecord extends SessionRecord {
  readonly messages: SessionMessageRecord[];
}

interface ListSessionsResponse {
  readonly sessions: SessionRecord[];
}

interface ArchiveSessionResponse {
  readonly session: SessionRecord;
}

interface OpenWorkspaceDirectoryResponse {
  readonly ok: true;
  readonly workspacePath: string;
}

interface ErrorResponse {
  readonly message?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getMonetClientConfig();
  const headers = new Headers(init?.headers);

  if (config.bearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${config.bearerToken}`);
  }

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    credentials: "omit",
    headers
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const error = (await response.json()) as ErrorResponse;

      if (typeof error.message === "string" && error.message.trim()) {
        message = error.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function listSessions() {
  return requestJson<ListSessionsResponse>("/api/sessions");
}

export async function getSessionDetail(sessionId: string) {
  return requestJson<SessionDetailRecord>(`/api/sessions/${sessionId}`);
}

export async function createSession(input?: { title?: string; providerId?: string; modelId?: string }) {
  return requestJson<SessionRecord>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input ?? {})
  });
}

export async function renameSession(sessionId: string, title: string) {
  return requestJson<SessionRecord>(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export async function archiveSession(sessionId: string) {
  return requestJson<ArchiveSessionResponse>(`/api/sessions/${sessionId}/archive`, {
    method: "POST"
  });
}

export async function openWorkspaceDirectory(sessionId: string) {
  return requestJson<OpenWorkspaceDirectoryResponse>(`/api/sessions/${sessionId}/workspace/open`, {
    method: "POST"
  });
}
