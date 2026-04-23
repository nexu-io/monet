export type ProviderType = "openai" | "openrouter";

export type ControllerRuntimeState = "starting" | "ready" | "restarting" | "stopped" | "failed";

export interface ControllerStatePayload {
  readonly state: ControllerRuntimeState;
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
  readonly message?: string;
  readonly restartAvailable?: boolean;
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

export type MonetDesktopApi = {
  readonly platform?: NodeJS.Platform;
  readonly clearProviderSecret?: (payload: { providerType: ProviderType }) => Promise<ProviderSecretStorageSnapshot>;
  readonly getControllerState?: () => ControllerStatePayload;
  readonly getProviderSecretStorage?: () => Promise<ProviderSecretStorageSnapshot>;
  readonly getRuntimeInfo?: () => {
    readonly apiBase?: string;
    readonly bearerToken?: string;
  };
  readonly onControllerStateChange?: (listener: (payload: ControllerStatePayload) => void) => () => void;
  readonly onShortcut?: (listener: (payload: { action: "new-session" | "open-settings" }) => void) => () => void;
  readonly restartController?: () => Promise<{ restarted: boolean; apiBase?: string; reason?: string }>;
  readonly saveProviderSecret?: (payload: {
    providerType: ProviderType;
    secret: string;
  }) => Promise<ProviderSecretStorageSnapshot>;
};

declare global {
  interface Window {
    readonly monetDesktop?: MonetDesktopApi;
  }
}

export interface MonetClientConfig {
  readonly apiBase: string;
  readonly bearerToken: string | null;
  readonly source: "preload" | "next-public-env" | "default";
}

export interface ControllerHealthResponse {
  readonly status: "ok";
  readonly service: "controller";
  readonly version: string;
}

const defaultApiBase = "http://127.0.0.1:3030";

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

  const envApiBase = process.env.NEXT_PUBLIC_MONET_CONTROLLER_URL?.trim();
  const envBearerToken = process.env.NEXT_PUBLIC_MONET_CONTROLLER_BEARER_TOKEN?.trim();

  if (envApiBase) {
    return {
      apiBase: envApiBase,
      bearerToken: envBearerToken || null,
      source: "next-public-env"
    };
  }

  return {
    apiBase: defaultApiBase,
    bearerToken: null,
    source: "default"
  };
}
