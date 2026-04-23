import { contextBridge, ipcRenderer } from "electron";

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "restarting" | "stopped" | "failed";
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
  readonly message?: string;
  readonly restartAvailable?: boolean;
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

let apiBase = getArgumentValue("--monet-api-base=");
let bearerToken = getArgumentValue("--monet-bearer-token=");
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
  getProviderSecretStorage(): Promise<ProviderSecretStorageSnapshot> {
    return ipcRenderer.invoke("monet:get-provider-secret-storage");
  },
  saveProviderSecret(payload: { providerType: ProviderType; secret: string }): Promise<ProviderSecretStorageSnapshot> {
    return ipcRenderer.invoke("monet:save-provider-secret", payload);
  },
  clearProviderSecret(payload: { providerType: ProviderType }): Promise<ProviderSecretStorageSnapshot> {
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
  if (/^https?:\/\//.test(input)) {
    return input;
  }

  return input.startsWith("/") ? input : `/${input}`;
}
