import { getMonetClientConfig } from "./monet-client";

import type {
  LiveArtifactResponse,
  LiveArtifactRefreshResponse as GeneratedLiveArtifactRefreshResponse,
  LiveArtifactSourceState,
  ListLiveArtifactsResponse,
  PostApiLiveArtifactsData,
  UpdateLiveArtifactRequest
} from "./api";

export interface LiveArtifactHtmlDocument {
  readonly format: "html_template_v1";
  readonly sanitizedHtml: string;
  readonly dataJson?: unknown;
  readonly dataSchemaJson?: unknown | null;
  readonly sourceJson?: unknown | null;
  readonly sanitizerVersion?: string;
}

export type LiveArtifactContentType = "html_page_v1";

export type LiveArtifactSummary = ListLiveArtifactsResponse["artifacts"][number] & {
  readonly contentType?: LiveArtifactContentType;
  readonly currentRevisionId?: string | null;
  readonly sourceStates?: readonly LiveArtifactSourceState[];
};
export type LiveArtifact = Omit<LiveArtifactResponse["artifact"], "tiles"> & {
  readonly contentType?: LiveArtifactContentType;
  readonly currentRevisionId?: string | null;
  readonly document?: LiveArtifactHtmlDocument | null;
  readonly sourceStates?: readonly LiveArtifactSourceState[];
  readonly tiles: readonly LiveArtifactTile[];
};
export type LiveArtifactTile = LiveArtifactResponse["artifact"]["tiles"][number] & {
  readonly sourceState?: LiveArtifactSourceState;
};
export type { LiveArtifactSourceState };
export type LiveArtifactCreateInput = PostApiLiveArtifactsData["body"];
export type LiveArtifactUpdateInput = UpdateLiveArtifactRequest;

export interface ListLiveArtifactsInput {
  readonly includeArchived?: boolean;
  readonly sessionId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LiveArtifactRefreshFailure {
  readonly tileId: string;
  readonly tileTitle: string;
  readonly toolName: string;
  readonly error: string;
}

export type LiveArtifactRefreshResponse = GeneratedLiveArtifactRefreshResponse & { readonly artifact: LiveArtifact };

interface ErrorResponse {
  readonly error?: string;
  readonly message?: string;
  readonly disabled?: boolean;
}

export class LiveArtifactsApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly disabled: boolean;
  readonly responseBody: unknown;

  constructor(message: string, options: { status: number; responseBody: unknown; errorCode?: string; disabled?: boolean }) {
    super(message);
    this.name = "LiveArtifactsApiError";
    this.status = options.status;
    this.errorCode = options.errorCode;
    this.disabled = options.disabled ?? false;
    this.responseBody = options.responseBody;
  }
}

function appendQuery(path: string, input?: ListLiveArtifactsInput) {
  if (!input) {
    return path;
  }

  const params = new URLSearchParams();

  if (input.includeArchived !== undefined) {
    params.set("includeArchived", input.includeArchived ? "true" : "false");
  }

  if (input.sessionId) {
    params.set("sessionId", input.sessionId);
  }

  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  if (input.offset !== undefined) {
    params.set("offset", String(input.offset));
  }

  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

async function parseErrorResponse(response: Response): Promise<{ message: string; body: unknown; errorCode?: string; disabled?: boolean }> {
  let body: unknown;
  let message = `Request failed with status ${response.status}.`;
  let errorCode: string | undefined;
  let disabled: boolean | undefined;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (body && typeof body === "object") {
    const error = body as ErrorResponse;

    if (typeof error.message === "string" && error.message.trim()) {
      message = error.message;
    }

    if (typeof error.error === "string" && error.error.trim()) {
      errorCode = error.error;
    }

    if (typeof error.disabled === "boolean") {
      disabled = error.disabled;
    }
  }

  return { message, body, errorCode, disabled };
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
    const error = await parseErrorResponse(response);

    throw new LiveArtifactsApiError(error.message, {
      status: response.status,
      responseBody: error.body,
      errorCode: error.errorCode,
      disabled: error.disabled
    });
  }

  return (await response.json()) as T;
}

export async function listLiveArtifacts(input?: ListLiveArtifactsInput) {
  return requestJson<ListLiveArtifactsResponse>(appendQuery("/api/live-artifacts", input));
}

export async function createLiveArtifact(input: LiveArtifactCreateInput) {
  return requestJson<LiveArtifactResponse>("/api/live-artifacts", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getLiveArtifact(artifactId: string) {
  return requestJson<LiveArtifactResponse>(`/api/live-artifacts/${encodeURIComponent(artifactId)}`);
}

export async function updateLiveArtifact(artifactId: string, input: LiveArtifactUpdateInput) {
  return requestJson<LiveArtifactResponse>(`/api/live-artifacts/${encodeURIComponent(artifactId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function pinLiveArtifact(artifactId: string, pinned: boolean) {
  return updateLiveArtifact(artifactId, { pinned });
}

export async function archiveLiveArtifact(artifactId: string) {
  return updateLiveArtifact(artifactId, { archived: true });
}

export async function refreshLiveArtifact(artifactId: string) {
  return requestJson<LiveArtifactRefreshResponse>(`/api/live-artifacts/${encodeURIComponent(artifactId)}/refresh`, {
    method: "POST"
  });
}
