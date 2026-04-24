import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import type { ChatStorage, ProviderValidationResult, StoredProvider } from "./chat-storage";
import type { OpenAIProviderConfig, OpenRouterProviderConfig } from "./config";
import { createLogger } from "./logger";

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
  syncProviderCatalog(providerId?: string): Promise<void>;
  validateProvider(providerId: string): Promise<ProviderValidationResult>;
  createChatModel(providerId: string, modelId: string): Promise<Parameters<typeof streamText>[0]["model"]>;
}

export function createProviderRuntime(options: {
  getChatStorage: () => ChatStorage;
  openai: OpenAIProviderConfig;
  openrouter: OpenRouterProviderConfig;
}): ProviderRuntime {
  return {
    async syncProviderCatalog(providerId) {
      const storage = options.getChatStorage();
      const providers = providerId ? [storage.getProvider(providerId)] : storage.listProviders();

      for (const provider of providers) {
        if (provider.type === "openai" || provider.type === "openrouter") {
          await syncOpenAICompatibleProviderCatalog({
            provider,
            storage,
            config: getProviderConfig(provider.type, options)
          });
        }
      }
    },

    async validateProvider(providerId) {
      const storage = options.getChatStorage();
      const provider = storage.getProvider(providerId);

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
          await syncOpenAICompatibleProviderCatalog({
            provider,
            storage,
            config: providerConfig
          });
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
          if (!options.openai.apiKey) {
            throw new ProviderRuntimeError({
              message: "OpenAI API key is not configured.",
              statusCode: 422,
              errorCode: "provider_invalid_config"
            });
          }

          const openai = createOpenAI({
            apiKey: options.openai.apiKey,
            baseURL: resolveProviderBaseUrl(provider, options.openai),
            fetch: createFetchWithTimeout(provider.timeoutMs ?? options.openai.timeoutMs)
          });

          return openai.responses(model.modelName);
        }
        case "openrouter": {
          if (!options.openrouter.apiKey) {
            throw new ProviderRuntimeError({
              message: "OpenRouter API key is not configured.",
              statusCode: 422,
              errorCode: "provider_invalid_config"
            });
          }

          const openrouter = createOpenAI({
            name: "openrouter",
            apiKey: options.openrouter.apiKey,
            baseURL: resolveProviderBaseUrl(provider, options.openrouter),
            headers: {
              "X-Title": "Monet"
            },
            fetch: createFetchWithTimeout(provider.timeoutMs ?? options.openrouter.timeoutMs)
          });

          return openrouter.responses(model.modelName);
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
  options: { openai: OpenAIProviderConfig; openrouter: OpenRouterProviderConfig }
) {
  return providerType === "openrouter" ? options.openrouter : options.openai;
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
