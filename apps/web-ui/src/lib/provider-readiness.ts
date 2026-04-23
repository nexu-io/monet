import type { Provider, ValidateProviderResponse } from "./api/generated/types.gen";
import { getMonetClientConfig } from "./monet-client";

export const PROVIDER_READINESS_EVENT = "monet:provider-readiness-updated";

interface ErrorResponse {
  readonly message?: string;
}

export interface ProviderReadinessTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerDisplayName: string;
  readonly modelName: string | null;
}

export interface ProviderReadinessSnapshot {
  readonly providers: Provider[];
  readonly readyProviders: ProviderReadinessTarget[];
  readonly hasConfiguredProviders: boolean;
  readonly hasReadyProvider: boolean;
  readonly firstReadyProvider: ProviderReadinessTarget | null;
}

async function requestControllerJson<T>(path: string, init?: RequestInit): Promise<T> {
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
    cache: "no-store",
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

export async function fetchProviderReadiness(): Promise<ProviderReadinessSnapshot> {
  const { providers } = await requestControllerJson<{ providers: Provider[] }>("/api/providers");
  const validations = await Promise.all(
    providers.map((provider) => requestControllerJson<ValidateProviderResponse>(`/api/providers/${provider.id}/validate`, { method: "POST" }))
  );
  const readyProviders = validations.flatMap((validation) => {
    if (!validation.valid || !validation.defaultModelId) {
      return [];
    }

    return [
      {
        providerId: validation.provider.id,
        modelId: validation.defaultModelId,
        providerDisplayName: validation.provider.displayName,
        modelName: validation.defaultModelName
      }
    ];
  });

  const firstReadyProvider = readyProviders[0] ?? null;

  return {
    providers,
    readyProviders,
    hasConfiguredProviders: providers.length > 0,
    hasReadyProvider: firstReadyProvider !== null,
    firstReadyProvider
  };
}
