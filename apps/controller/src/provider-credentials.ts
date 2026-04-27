import type { OpenAIProviderConfig } from "./config";

export type ProviderCredentialType = "openai" | "openrouter";
export type ProviderCredentialSource = "env" | "runtime" | "none";

export interface ProviderCredentialStatus {
  readonly providerType: ProviderCredentialType;
  readonly hasCredential: boolean;
  readonly source: ProviderCredentialSource;
  readonly version: number;
}

export interface ProviderCredentialRegistry {
  clearRuntimeApiKey(providerType: ProviderCredentialType): ProviderCredentialStatus;
  getApiKey(providerType: ProviderCredentialType): string | null;
  getStatus(providerType: ProviderCredentialType): ProviderCredentialStatus;
  getVersion(providerType: ProviderCredentialType): number;
  setRuntimeApiKey(providerType: ProviderCredentialType, apiKey: string): ProviderCredentialStatus;
}

export function createProviderCredentialRegistry(seed: {
  readonly openai: Pick<OpenAIProviderConfig, "apiKey">;
  readonly openrouterApiKey: string | null;
}): ProviderCredentialRegistry {
  const envKeys: Record<ProviderCredentialType, string | null> = {
    openai: seed.openai.apiKey,
    openrouter: seed.openrouterApiKey
  };
  const runtimeKeys: Partial<Record<ProviderCredentialType, string>> = {};
  const versions: Record<ProviderCredentialType, number> = {
    openai: 0,
    openrouter: 0
  };

  return {
    clearRuntimeApiKey(providerType) {
      delete runtimeKeys[providerType];
      versions[providerType] += 1;

      return this.getStatus(providerType);
    },

    getApiKey(providerType) {
      return envKeys[providerType] ?? runtimeKeys[providerType] ?? null;
    },

    getStatus(providerType) {
      const hasEnvKey = Boolean(envKeys[providerType]);
      const hasRuntimeKey = Boolean(runtimeKeys[providerType]);

      return {
        providerType,
        hasCredential: hasEnvKey || hasRuntimeKey,
        source: hasEnvKey ? "env" : hasRuntimeKey ? "runtime" : "none",
        version: versions[providerType]
      };
    },

    getVersion(providerType) {
      return versions[providerType];
    },

    setRuntimeApiKey(providerType, apiKey) {
      const normalizedApiKey = apiKey.trim();

      if (!normalizedApiKey) {
        throw new Error("Provider API key cannot be empty.");
      }

      runtimeKeys[providerType] = normalizedApiKey;
      versions[providerType] += 1;

      return this.getStatus(providerType);
    }
  };
}
