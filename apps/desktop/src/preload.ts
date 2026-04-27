import { contextBridge, ipcRenderer } from "electron";

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "restarting" | "stopped" | "failed";
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
  readonly message?: string;
  readonly restartAvailable?: boolean;
}

interface UpdateStatePayload {
  readonly state: "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  readonly message: string;
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly downloadedVersion?: string;
  readonly downloadProgressPercent?: number;
}

interface PreloadRequestResult {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

type DesktopShortcutAction = "new-session" | "open-settings";

type ProviderType = "openai" | "openrouter";

interface ProviderSecretStorageSnapshot {
  readonly available: boolean;
  readonly message: string;
  readonly platform: NodeJS.Platform | "browser";
  readonly providers: ReadonlyArray<{
    readonly providerType: ProviderType;
    readonly hasSecret: boolean;
  }>;
  readonly reason: "available" | "desktop_api_unavailable" | "linux_keyring_unavailable" | "encryption_unavailable";
}

interface ProviderSecretMutationResult {
  readonly controllerSync: {
    readonly applied: boolean;
    readonly reason?: string;
  };
  readonly storage: ProviderSecretStorageSnapshot;
}

interface DesktopAppPathsSnapshot {
  readonly userDataPath: string;
}

interface OpenPathResult {
  readonly opened: boolean;
  readonly path?: string;
  readonly error?: string;
}

const runtimeInfo = ipcRenderer.sendSync("monet:get-runtime-info-sync") as {
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
};

let apiBase = runtimeInfo.apiBase ?? getArgumentValue("--monet-api-base=");
let bearerToken = runtimeInfo.bearerToken ?? undefined;
const controllerManaged = getArgumentValue("--monet-controller-managed=") !== "false";
let controllerState: ControllerStatePayload = apiBase
  ? {
      state: "ready",
      apiBase,
      ...(bearerToken !== undefined ? { bearerToken } : {}),
      restartAvailable: controllerManaged
    }
  : {
      state: "starting",
      message: "Waiting for the local Monet controller to finish starting.",
      restartAvailable: controllerManaged
    };

ipcRenderer.on("monet:controller-state", (_event, payload: ControllerStatePayload) => {
  if (payload.apiBase) {
    apiBase = payload.apiBase;
  }

  if (payload.bearerToken !== undefined) {
    bearerToken = payload.bearerToken ?? undefined;
  }

  const nextApiBase = payload.apiBase ?? apiBase;
  const nextBearerToken = payload.bearerToken !== undefined ? payload.bearerToken : bearerToken;

  controllerState = {
    state: payload.state,
    ...(nextApiBase !== undefined ? { apiBase: nextApiBase } : {}),
    ...(nextBearerToken !== undefined ? { bearerToken: nextBearerToken } : {}),
    ...(payload.message !== undefined ? { message: payload.message } : controllerState.message !== undefined ? { message: controllerState.message } : {}),
    ...(payload.restartAvailable !== undefined
      ? { restartAvailable: payload.restartAvailable }
      : controllerState.restartAvailable !== undefined
        ? { restartAvailable: controllerState.restartAvailable }
        : {})
  };
});

contextBridge.exposeInMainWorld("monetDesktop", {
  platform: process.platform,
  getControllerState() {
    return controllerState;
  },
  getRuntimeInfo() {
    return {
      apiBase,
      bearerToken
    };
  },
  async request(input: string, init?: RequestInit): Promise<PreloadRequestResult> {
    if (!apiBase) {
      throw new Error("The Monet desktop preload did not receive an apiBase value.");
    }

    const headers = new Headers(init?.headers);

    if (bearerToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${bearerToken}`);
    }

    const response = await fetch(new URL(normalizeRequestPath(input), apiBase).toString(), {
      ...init,
      credentials: "omit",
      headers
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text()
    };
  },
  restartController() {
    return ipcRenderer.invoke("monet:restart-controller");
  },
  getUpdateState(): Promise<UpdateStatePayload> {
    return ipcRenderer.invoke("monet:get-update-state");
  },
  checkForUpdates(): Promise<UpdateStatePayload> {
    return ipcRenderer.invoke("monet:check-for-updates");
  },
  installUpdate(): Promise<{ started: boolean }> {
    return ipcRenderer.invoke("monet:install-update");
  },
  getProviderSecretStorage(): Promise<ProviderSecretStorageSnapshot> {
    return ipcRenderer.invoke("monet:get-provider-secret-storage");
  },
  getAppPaths(): Promise<DesktopAppPathsSnapshot> {
    return ipcRenderer.invoke("monet:get-app-paths");
  },
  pickDirectory(): Promise<string | null> {
    return ipcRenderer.invoke("monet:pick-directory");
  },
  openPath(payload: { path: string }): Promise<OpenPathResult> {
    return ipcRenderer.invoke("monet:open-path", payload);
  },
  openWorkspaceDirectory(payload: { sessionId: string }): Promise<OpenPathResult> {
    return ipcRenderer.invoke("monet:open-workspace-directory", payload);
  },
  saveProviderSecret(payload: { providerType: ProviderType; secret: string }): Promise<ProviderSecretMutationResult> {
    return ipcRenderer.invoke("monet:save-provider-secret", payload);
  },
  clearProviderSecret(payload: { providerType: ProviderType }): Promise<ProviderSecretMutationResult> {
    return ipcRenderer.invoke("monet:clear-provider-secret", payload);
  },
  onControllerStateChange(listener: (payload: ControllerStatePayload) => void) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: ControllerStatePayload) => {
      listener(payload);
    };

    ipcRenderer.on("monet:controller-state", wrappedListener);

    return () => {
      ipcRenderer.removeListener("monet:controller-state", wrappedListener);
    };
  },
  onUpdateStateChange(listener: (payload: UpdateStatePayload) => void) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: UpdateStatePayload) => {
      listener(payload);
    };

    ipcRenderer.on("monet:update-state", wrappedListener);

    return () => {
      ipcRenderer.removeListener("monet:update-state", wrappedListener);
    };
  },
  onShortcut(listener: (payload: { action: DesktopShortcutAction }) => void) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: { action: DesktopShortcutAction }) => {
      listener(payload);
    };

    ipcRenderer.on("monet:shortcut", wrappedListener);

    return () => {
      ipcRenderer.removeListener("monet:shortcut", wrappedListener);
    };
  }
});

function getArgumentValue(prefix: string) {
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function normalizeRequestPath(input: string) {
  const normalizedInput = input.trim();

  if (!normalizedInput) {
    throw new Error("Monet desktop requests require a controller-relative path.");
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalizedInput) || normalizedInput.startsWith("//")) {
    throw new Error("Monet desktop requests must use a controller-relative path.");
  }

  if (normalizedInput.startsWith("?") || normalizedInput.startsWith("#")) {
    return `/${normalizedInput}`;
  }

  return normalizedInput.startsWith("/") ? normalizedInput : `/${normalizedInput}`;
}
