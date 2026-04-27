export interface OpenWorkspaceControllerRuntime {
  readonly apiBase: string;
  readonly bearerToken: string | null;
}

export interface OpenPathResult {
  readonly opened: boolean;
  readonly path?: string;
  readonly error?: string;
  readonly errorDetails?: OpenPathErrorDetails;
}

export interface OpenPathErrorDetails {
  readonly workspacePath?: string;
  readonly nativeOpenFailureReason?: string;
}

interface OpenWorkspaceDirectoryResponse {
  readonly ok: true;
  readonly workspacePath: string;
}

interface OpenWorkspaceDirectoryOptions {
  readonly sessionId: string | null | undefined;
  readonly runtime: OpenWorkspaceControllerRuntime | null;
  readonly fetchImpl?: typeof fetch;
  readonly mkdirWorkspace: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>;
  readonly openPath: (path: string) => Promise<string>;
}

export async function openWorkspaceDirectoryForSession({
  sessionId: rawSessionId,
  runtime,
  fetchImpl = fetch,
  mkdirWorkspace,
  openPath
}: OpenWorkspaceDirectoryOptions): Promise<OpenPathResult> {
  const sessionId = rawSessionId?.trim() ?? "";

  if (!sessionId) {
    return {
      opened: false,
      error: "Session ID is required."
    };
  }

  const workspaceResult = await ensureWorkspaceDirectoryForSession(sessionId, runtime, fetchImpl);

  if (!workspaceResult.ok) {
    return {
      opened: false,
      ...(workspaceResult.workspacePath ? { path: workspaceResult.workspacePath } : {}),
      error: workspaceResult.error
    };
  }

  const workspacePath = workspaceResult.workspacePath;

  try {
    await mkdirWorkspace(workspacePath, {
      recursive: true,
      mode: 0o700
    });
  } catch (error) {
    return {
      opened: false,
      path: workspacePath,
      error: error instanceof Error ? error.message : "Could not create the workspace directory."
    };
  }

  const error = await openPath(workspacePath);

  if (error.length > 0) {
    return {
      opened: false,
      path: workspacePath,
      error: `Could not open the workspace folder: ${error}`,
      errorDetails: {
        workspacePath,
        nativeOpenFailureReason: error
      }
    };
  }

  return {
    opened: true,
    path: workspacePath
  };
}

export async function ensureWorkspaceDirectoryForSession(
  sessionId: string,
  runtime: OpenWorkspaceControllerRuntime | null,
  fetchImpl: typeof fetch = fetch
): Promise<
  | {
      readonly ok: true;
      readonly workspacePath: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly workspacePath?: string;
    }
> {
  if (!runtime) {
    return {
      ok: false,
      error: "The Monet controller is not available."
    };
  }

  const headers: Record<string, string> = {};

  if (runtime.bearerToken) {
    headers.Authorization = `Bearer ${runtime.bearerToken}`;
  }

  try {
    const response = await fetchImpl(
      new URL(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/open`, runtime.apiBase).toString(),
      {
        method: "POST",
        headers
      }
    );
    const responseBody = await response.text();
    const parsedBody = parseJsonResponse(responseBody);
    const workspacePath = getWorkspacePathFromResponse(parsedBody);

    if (!response.ok) {
      return {
        ok: false,
        ...(workspacePath ? { workspacePath } : {}),
        error: getControllerErrorMessage(parsedBody, response.status)
      };
    }

    if (!workspacePath) {
      return {
        ok: false,
        error: "The controller did not return a workspace path."
      };
    }

    return {
      ok: true,
      workspacePath
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not contact the Monet controller."
    };
  }
}

function parseJsonResponse(responseBody: string): unknown {
  if (!responseBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    return null;
  }
}

function getWorkspacePathFromResponse(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object" || !("workspacePath" in responseBody)) {
    return null;
  }

  const workspacePath = (responseBody as Partial<OpenWorkspaceDirectoryResponse>).workspacePath;

  return typeof workspacePath === "string" && workspacePath.trim().length > 0 ? workspacePath : null;
}

function getControllerErrorMessage(responseBody: unknown, status: number) {
  if (responseBody && typeof responseBody === "object") {
    const candidate = responseBody as { error?: unknown; message?: unknown };

    if (typeof candidate.error === "string" && candidate.error.trim().length > 0) {
      return candidate.error;
    }

    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      return candidate.message;
    }
  }

  return `The controller returned ${status}.`;
}
