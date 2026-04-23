import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import type { ChatStorage, ProviderValidationResult, StoredProvider } from "./chat-storage";
import type { OpenAIProviderConfig } from "./config";
import { createLogger } from "./logger";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

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
}): ProviderRuntime {
  return {
    async syncProviderCatalog(providerId) {
      const storage = options.getChatStorage();
      const providers = providerId ? [storage.getProvider(providerId)] : storage.listProviders();

      for (const provider of providers) {
        if (provider.type === "openai") {
          await syncOpenAIProviderCatalog({
            provider,
            storage,
            config: options.openai
          });
        }
      }
    },

    async validateProvider(providerId) {
      const storage = options.getChatStorage();
      const provider = storage.getProvider(providerId);

      if (provider.type === "openai") {
        if (!options.openai.apiKey) {
          return buildInvalidProviderValidation(provider, "missing_credentials", "OpenAI API key is not configured.");
        }

        try {
          await syncOpenAIProviderCatalog({
            provider,
            storage,
            config: options.openai
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

async function syncOpenAIProviderCatalog(options: {
  provider: StoredProvider;
  storage: ChatStorage;
  config: OpenAIProviderConfig;
}) {
  if (!options.config.apiKey) {
    return;
  }

  const models = await fetchOpenAIModels({
    apiKey: options.config.apiKey,
    baseUrl: resolveProviderBaseUrl(options.provider, options.config),
    timeoutMs: options.provider.timeoutMs ?? options.config.timeoutMs
  });
  const filteredModels = models.filter((modelName) => isSupportedChatModel(modelName));

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

function resolveProviderBaseUrl(provider: StoredProvider, config: OpenAIProviderConfig) {
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

function isSupportedChatModel(modelName: string) {
  if (/(embedding|image|tts|transcri|whisper|moderation|omni-moderation|audio|realtime|search)/i.test(modelName)) {
    return false;
  }

  return /(^gpt|^o[1-9]|chatgpt|reason)/i.test(modelName);
}

function isReasoningModelName(modelName: string) {
  return /^(o1|o3|o4)/i.test(modelName) || /reason/i.test(modelName);
}

function createFetchWithTimeout(timeoutMs: number | null | undefined) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    if (!timeoutMs) {
      return fetch(input, init);
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error(`Request timed out after ${timeoutMs}ms.`)),
      timeoutMs
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
