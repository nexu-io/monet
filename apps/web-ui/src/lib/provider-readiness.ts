import type { Provider, ProviderModel } from "./api/generated/types.gen";
import { getMonetClientConfig } from "./monet-client";

export interface ProviderReadinessTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerDisplayName: string;
  readonly modelName: string | null;
}

interface ErrorResponse {
  readonly message?: string;
}

async function requestControllerJson<T>(path: string): Promise<T> {
  const config = getMonetClientConfig();
  const headers = new Headers();

  if (config.bearerToken) {
    headers.set("Authorization", `Bearer ${config.bearerToken}`);
  }

  const response = await fetch(`${config.apiBase}${path}`, {
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

export async function fetchProviderTargets(): Promise<ProviderReadinessTarget[]> {
  const [{ providers }, { models }] = await Promise.all([
    requestControllerJson<{ providers: Provider[] }>("/api/providers"),
    requestControllerJson<{ models: ProviderModel[] }>("/api/models")
  ]);
  const providersById = new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.id, provider]));

  return models
    .filter((model) => model.enabled && providersById.has(model.providerId))
    .map((model) => {
      const provider = providersById.get(model.providerId);

      return {
        providerId: model.providerId,
        modelId: model.id,
        providerDisplayName: provider?.displayName ?? model.providerId,
        modelName: model.modelName
      };
    });
}
