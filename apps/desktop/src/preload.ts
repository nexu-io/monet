import { contextBridge, ipcRenderer } from "electron";

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "stopped";
  readonly apiBase?: string;
}

interface PreloadRequestResult {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const apiBase = getArgumentValue("--monet-api-base=");
const bearerToken = getArgumentValue("--monet-bearer-token=");

contextBridge.exposeInMainWorld("monetDesktop", {
  apiBase,
  bearerToken,
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
