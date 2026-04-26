import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import type { ChatStorage, ProviderValidationResult, StoredProvider } from "./chat-storage";
import type { OpenAIProviderConfig, OpenRouterProviderConfig } from "./config";
import { createLogger } from "./logger";
import type { ProviderCredentialRegistry } from "./provider-credentials";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_PROVIDER_FETCH_TIMEOUT_MS = 10_000;

const providerLogger = createLogger("controller", {
  component: "provider-runtime"
});

interface OpenAIModelListResponse {
  readonly data?: Array<{
    readonly id?: string;
    readonly object?: string;
    readonly owned_by?: string;
  }>;
}

export class ProviderRuntimeError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(options: { message: string; statusCode?: number; errorCode?: string }) {
    super(options.message);
    this.name = "ProviderRuntimeError";
    this.statusCode = options.statusCode ?? 500;
    this.errorCode = options.errorCode ?? "provider_runtime_error";
  }
}

export interface ProviderRuntime {
  syncProviderCatalog(providerId?: string, options?: { force?: boolean }): Promise<void>;
  validateProvider(providerId: string, options?: { force?: boolean }): Promise<ProviderValidationResult>;
  invalidateProviderCache(providerId?: string): void;
  createChatModel(providerId: string, modelId: string): Promise<Parameters<typeof streamText>[0]["model"]>;
}

const PROVIDER_CATALOG_CACHE_TTL_MS = 5 * 60_000;
const PROVIDER_VALIDATION_CACHE_TTL_MS = 60_000;

interface ProviderCacheEntry<T> {
  readonly credentialVersion: number;
  readonly providerUpdatedAt: string;
  readonly value: T;
  readonly cachedAt: number;
}

export function createProviderRuntime(options: {
  getChatStorage: () => ChatStorage;
  openai: OpenAIProviderConfig;
  openrouter: OpenRouterProviderConfig;
  providerCredentials: ProviderCredentialRegistry;
}): ProviderRuntime {
  const catalogSyncCache = new Map<string, ProviderCacheEntry<true>>();
  const catalogSyncRequests = new Map<string, Promise<void>>();
  const validationCache = new Map<string, ProviderCacheEntry<ProviderValidationResult>>();
  const validationRequests = new Map<string, Promise<ProviderValidationResult>>();

  function invalidateProviderCache(providerId?: string) {
    if (providerId) {
      catalogSyncCache.delete(providerId);
      validationCache.delete(providerId);
      return;
    }

    catalogSyncCache.clear();
    validationCache.clear();
  }

  const runtime: ProviderRuntime = {
    invalidateProviderCache,

    async syncProviderCatalog(providerId, syncOptions) {
      const storage = options.getChatStorage();
      const providers = providerId ? [storage.getProvider(providerId)] : storage.listProviders();

      for (const provider of providers) {
        if (provider.type === "openai" || provider.type === "openrouter") {
          const credentialVersion = options.providerCredentials.getVersion(provider.type);
          const cachedSync = catalogSyncCache.get(provider.id);
          const now = Date.now();

          if (
            !syncOptions?.force &&
            cachedSync &&
            cachedSync.providerUpdatedAt === provider.updatedAt &&
            cachedSync.credentialVersion === credentialVersion &&
            now - cachedSync.cachedAt < PROVIDER_CATALOG_CACHE_TTL_MS
          ) {
            continue;
          }

          const existingRequest = catalogSyncRequests.get(provider.id);

          if (existingRequest) {
            await existingRequest;
            continue;
          }

          const request = syncOpenAICompatibleProviderCatalog({
            provider,
            storage,
            config: getProviderConfig(provider.type, options)
          })
            .then(() => {
              catalogSyncCache.set(provider.id, {
                credentialVersion: options.providerCredentials.getVersion(provider.type),
                providerUpdatedAt: options.getChatStorage().getProvider(provider.id).updatedAt,
                value: true,
                cachedAt: Date.now()
              });
              validationCache.delete(provider.id);
            })
            .finally(() => {
              catalogSyncRequests.delete(provider.id);
            });

          catalogSyncRequests.set(provider.id, request);
          await request;
        }
      }
    },

    async validateProvider(providerId, validationOptions) {
      const storage = options.getChatStorage();
      const provider = storage.getProvider(providerId);
      const credentialVersion = provider.type === "openai" || provider.type === "openrouter" ? options.providerCredentials.getVersion(provider.type) : 0;
      const cachedValidation = validationCache.get(providerId);
      const now = Date.now();

      if (
        !validationOptions?.force &&
        cachedValidation &&
        cachedValidation.providerUpdatedAt === provider.updatedAt &&
        cachedValidation.credentialVersion === credentialVersion &&
        now - cachedValidation.cachedAt < PROVIDER_VALIDATION_CACHE_TTL_MS
      ) {
        return cachedValidation.value;
      }

      const existingRequest = validationRequests.get(providerId);

      if (existingRequest) {
        return existingRequest;
      }

      const request = (async () => {

        if (provider.type === "openai" || provider.type === "openrouter") {
          const providerConfig = getProviderConfig(provider.type, options);

          if (!providerConfig.apiKey) {
            return buildInvalidProviderValidation(
              provider,
              "missing_credentials",
              `${provider.displayName} API key is not configured.`
            );
          }

          try {
            await runtime.syncProviderCatalog(providerId, validationOptions);
          } catch (error) {
            providerLogger.warn("providers.validate_failed", {
              providerId,
              providerType: provider.type,
              reason: error instanceof Error ? error.message : "unknown_error"
            });

            return buildInvalidProviderValidation(
              provider,
              "provider_api_error",
              error instanceof Error ? error.message : "Failed to fetch provider models."
            );
          }

        }

        return storage.validateProvider(providerId);
      })()
        .then((result) => {
          validationCache.set(providerId, {
            credentialVersion:
              provider.type === "openai" || provider.type === "openrouter" ? options.providerCredentials.getVersion(provider.type) : 0,
            providerUpdatedAt: options.getChatStorage().getProvider(providerId).updatedAt,
            value: result,
            cachedAt: Date.now()
          });

          return result;
        })
        .finally(() => {
          validationRequests.delete(providerId);
        });

      validationRequests.set(providerId, request);
      return request;
    },

    async createChatModel(providerId, modelId) {
      const storage = options.getChatStorage();
      const provider = storage.getProvider(providerId);
      const model = storage.getModel(modelId);

      if (model.providerId !== provider.id) {
        throw new ProviderRuntimeError({
          message: "The requested modelId does not belong to the requested providerId.",
          statusCode: 422,
          errorCode: "provider_model_mismatch"
        });
      }

      if (!model.enabled) {
        throw new ProviderRuntimeError({
          message: `Model is disabled: ${model.id}`,
          statusCode: 422,
          errorCode: "model_disabled"
        });
      }

      switch (provider.type) {
        case "openai": {
          const providerConfig = getProviderConfig(provider.type, options);

          if (!providerConfig.apiKey) {
            throw new ProviderRuntimeError({
              message: "OpenAI API key is not configured.",
              statusCode: 422,
              errorCode: "provider_invalid_config"
            });
          }

          const openai = createOpenAI({
            apiKey: providerConfig.apiKey,
            baseURL: resolveProviderBaseUrl(provider, providerConfig),
            fetch: createFetchWithTimeout(provider.timeoutMs ?? providerConfig.timeoutMs)
          });

          return openai.responses(model.modelName);
        }
        case "openrouter": {
          const providerConfig = getProviderConfig(provider.type, options);

          if (!providerConfig.apiKey) {
            throw new ProviderRuntimeError({
              message: "OpenRouter API key is not configured.",
              statusCode: 422,
              errorCode: "provider_invalid_config"
            });
          }

          const openrouter = createOpenAI({
            name: "openrouter",
            apiKey: providerConfig.apiKey,
            baseURL: resolveProviderBaseUrl(provider, providerConfig),
            headers: {
              "X-Title": "Monet"
            },
            fetch: createFetchWithTimeout(provider.timeoutMs ?? providerConfig.timeoutMs)
          });

          return openrouter.chat(model.modelName);
        }
        default:
          throw new ProviderRuntimeError({
            message: `Unsupported provider type: ${provider.type}`,
            statusCode: 422,
            errorCode: "unsupported_provider"
          });
      }
    }
  };

  return runtime;
}

async function syncOpenAICompatibleProviderCatalog(options: {
  provider: StoredProvider;
  storage: ChatStorage;
  config: OpenAIProviderConfig | OpenRouterProviderConfig;
}) {
  if (!options.config.apiKey) {
    return;
  }

  const models = await fetchOpenAIModels({
    apiKey: options.config.apiKey,
    baseUrl: resolveProviderBaseUrl(options.provider, options.config),
    timeoutMs: options.provider.timeoutMs ?? options.config.timeoutMs
  });
  const filteredModels = models.filter((modelName) => isSupportedChatModel(options.provider.type, modelName));

  options.storage.replaceProviderCatalog({
    providerId: options.provider.id,
    defaultModelName: options.provider.defaultModelName ?? options.config.defaultModel,
    models: filteredModels.map((modelName) => ({
      modelName,
      displayName: modelName,
      supportsTools: true,
      supportsReasoning: isReasoningModelName(modelName),
      capabilitiesJson: JSON.stringify({ source: "openai.models.list" })
    }))
  });

  providerLogger.info("providers.catalog_synced", {
    providerId: options.provider.id,
    providerType: options.provider.type,
    modelCount: filteredModels.length
  });
}

async function fetchOpenAIModels(options: { apiKey: string; baseUrl: string; timeoutMs: number | null }) {
  const response = await createFetchWithTimeout(options.timeoutMs)(`${options.baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`OpenAI model listing failed with status ${response.status}.`);
  }

  const json = (await response.json()) as OpenAIModelListResponse;

  return (json.data ?? [])
    .map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
    .filter((modelName) => modelName.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function getProviderConfig(
  providerType: StoredProvider["type"],
  options: { openai: OpenAIProviderConfig; openrouter: OpenRouterProviderConfig; providerCredentials: ProviderCredentialRegistry }
) {
  if (providerType === "openrouter") {
    return {
      ...options.openrouter,
      apiKey: options.providerCredentials.getApiKey("openrouter")
    };
  }

  return {
    ...options.openai,
    apiKey: options.providerCredentials.getApiKey("openai")
  };
}

function resolveProviderBaseUrl(
  provider: StoredProvider,
  config: OpenAIProviderConfig | OpenRouterProviderConfig
) {
  if (provider.type === "openrouter") {
    return provider.baseUrl ?? config.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL;
  }

  return provider.baseUrl ?? config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
}

function buildInvalidProviderValidation(
  provider: StoredProvider,
  reason: Extract<ProviderValidationResult["reason"], "missing_credentials" | "provider_api_error">,
  message: string
): ProviderValidationResult {
  return {
    provider,
    valid: false,
    reason,
    message,
    defaultModelId: null,
    defaultModelName: provider.defaultModelName,
    availableModelCount: 0
  };
}

function isSupportedChatModel(providerType: StoredProvider["type"], modelName: string) {
  if (/(embedding|image|tts|transcri|whisper|moderation|omni-moderation|audio|realtime|search)/i.test(modelName)) {
    return false;
  }

  if (providerType === "openrouter") {
    return true;
  }

  return /(^gpt|^o[1-9]|chatgpt|reason)/i.test(modelName);
}

function isReasoningModelName(modelName: string) {
  return /^(o1|o3|o4)/i.test(modelName) || /reason/i.test(modelName);
}

export function createFetchWithTimeout(timeoutMs: number | null | undefined, defaultTimeoutMs = DEFAULT_PROVIDER_FETCH_TIMEOUT_MS) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const effectiveTimeoutMs = timeoutMs ?? defaultTimeoutMs;

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error(`Request timed out after ${effectiveTimeoutMs}ms.`)),
      effectiveTimeoutMs
    );

    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, timeoutController.signal]) : timeoutController.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}
