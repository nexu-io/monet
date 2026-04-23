import { contextBridge, ipcRenderer } from "electron";

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "stopped";
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
}

interface PreloadRequestResult {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

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

ipcRenderer.on("monet:controller-state", (_event, payload: ControllerStatePayload) => {
  if (payload.apiBase) {
    apiBase = payload.apiBase;
  }

  if (payload.bearerToken !== undefined) {
    bearerToken = payload.bearerToken ?? undefined;
  }
});

contextBridge.exposeInMainWorld("monetDesktop", {
  apiBase,
  bearerToken,
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
