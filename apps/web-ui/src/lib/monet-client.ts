export type ProviderType = "openai" | "openrouter";

export type ControllerRuntimeState = "starting" | "ready" | "restarting" | "stopped" | "failed";

export interface ControllerStatePayload {
  readonly state: ControllerRuntimeState;
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
  readonly message?: string;
  readonly restartAvailable?: boolean;
}

export type UpdateLifecycleState = "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateStatePayload {
  readonly state: UpdateLifecycleState;
  readonly message: string;
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly downloadedVersion?: string;
  readonly downloadProgressPercent?: number;
}

export interface ProviderSecretStorageSnapshot {
  readonly available: boolean;
  readonly message: string;
  readonly platform: NodeJS.Platform | "browser";
  readonly providers: ReadonlyArray<{
    readonly providerType: ProviderType;
    readonly hasSecret: boolean;
  }>;
  readonly reason: "available" | "desktop_api_unavailable" | "linux_keyring_unavailable" | "encryption_unavailable";
}

export interface ProviderSecretMutationResult {
  readonly controllerSync: {
    readonly applied: boolean;
    readonly reason?: string;
  };
  readonly storage: ProviderSecretStorageSnapshot;
}

export interface DesktopAppPathsSnapshot {
  readonly userDataPath: string;
}

export interface OpenPathResult {
  readonly opened: boolean;
  readonly path?: string;
  readonly error?: string;
}

export type MonetDesktopApi = {
  readonly platform?: NodeJS.Platform;
  readonly clearProviderSecret?: (payload: { providerType: ProviderType }) => Promise<ProviderSecretMutationResult>;
  readonly checkForUpdates?: () => Promise<UpdateStatePayload>;
  readonly getAppPaths?: () => Promise<DesktopAppPathsSnapshot>;
  readonly getControllerState?: () => ControllerStatePayload;
  readonly getProviderSecretStorage?: () => Promise<ProviderSecretStorageSnapshot>;
  readonly getUpdateState?: () => Promise<UpdateStatePayload>;
  readonly getRuntimeInfo?: () => {
    readonly apiBase?: string;
    readonly bearerToken?: string;
  };
  readonly installUpdate?: () => Promise<{ started: boolean }>;
  readonly openPath?: (payload: { path: string }) => Promise<OpenPathResult>;
  readonly openWorkspaceDirectory?: (payload: { sessionId: string }) => Promise<OpenPathResult>;
  readonly onControllerStateChange?: (listener: (payload: ControllerStatePayload) => void) => () => void;
  readonly onUpdateStateChange?: (listener: (payload: UpdateStatePayload) => void) => () => void;
  readonly onShortcut?: (listener: (payload: { action: "new-session" | "open-settings" }) => void) => () => void;
  readonly pickDirectory?: () => Promise<string | null>;
  readonly restartController?: () => Promise<{ restarted: boolean; apiBase?: string; reason?: string }>;
  readonly saveProviderSecret?: (payload: {
    providerType: ProviderType;
    secret: string;
  }) => Promise<ProviderSecretMutationResult>;
};

declare global {
  interface Window {
    readonly monetDesktop?: MonetDesktopApi;
  }
}

export interface MonetClientConfig {
  readonly apiBase: string;
  readonly bearerToken: string | null;
  readonly source: "preload" | "vite-public-env" | "default";
}

export interface ControllerHealthResponse {
  readonly status: "ok";
  readonly service: "controller";
  readonly version: string;
}

const defaultApiBase = "http://127.0.0.1:42831";

export function getMonetClientConfig(): MonetClientConfig {
  const desktopApi = typeof window !== "undefined" ? window.monetDesktop : undefined;
  const runtimeInfo = desktopApi?.getRuntimeInfo?.();
  const preloadApiBase = runtimeInfo?.apiBase;
  const preloadBearerToken = runtimeInfo?.bearerToken;

  if (preloadApiBase) {
    return {
      apiBase: preloadApiBase,
      bearerToken: preloadBearerToken ?? null,
      source: "preload"
    };
  }

  const envApiBase = import.meta.env.VITE_MONET_CONTROLLER_URL?.trim();
  const envBearerToken = import.meta.env.VITE_MONET_CONTROLLER_BEARER_TOKEN?.trim();

  if (envApiBase) {
    return {
      apiBase: envApiBase,
      bearerToken: envBearerToken || null,
      source: "vite-public-env"
    };
  }

  return {
    apiBase: defaultApiBase,
    bearerToken: null,
    source: "default"
  };
}
