export type MonetDesktopApi = {
  readonly apiBase?: string;
  readonly bearerToken?: string;
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
  if (typeof window !== "undefined" && window.monetDesktop?.apiBase) {
    return {
      apiBase: window.monetDesktop.apiBase,
      bearerToken: window.monetDesktop.bearerToken ?? null,
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
