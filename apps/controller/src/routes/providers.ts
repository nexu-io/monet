import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import type { ProviderCredentialRegistry, ProviderCredentialType } from "../provider-credentials";
import type { ProviderRuntime } from "../provider-runtime";
import {
  ErrorResponseSchema,
  ListModelsResponseSchema,
  ListProvidersResponseSchema,
  ProviderSchema,
  CreateProviderRequestSchema,
  CreateProviderModelRequestSchema,
  CreateProviderModelWithProviderRequestSchema,
  UpdateProviderRequestSchema,
  ProviderModelSchema,
  UpdateProviderModelRequestSchema,
  ValidateProviderResponseSchema,
  createErrorResponse
} from "../openapi";

const providersLogger = createLogger("controller", {
  component: "providers-route"
});

const providerIdParamSchema = z.object({
  providerId: z.string().trim().min(1).openapi({ example: "pro_123" })
});

const providerModelIdParamSchema = z.object({
  modelId: z.string().trim().min(1).openapi({ example: "mod_123" })
});

const providerTypeParamSchema = z.object({
  providerType: z.enum(["openai", "openrouter"]).openapi({ example: "openai" })
});

const ProviderCredentialStatusSchema = z.object({
  providerType: z.enum(["openai", "openrouter"]),
  hasCredential: z.boolean(),
  source: z.enum(["env", "runtime", "none"]),
  version: z.number().int().nonnegative()
});

const UpdateProviderCredentialRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(20_000)
});

const listProvidersRoute = createRoute({
  method: "get",
  path: "/api/providers",
  tags: ["Providers"],
  summary: "List providers",
  description: "Returns persisted providers ordered by enabled status and name.",
  responses: {
    200: {
      description: "Providers fetched successfully.",
      content: {
        "application/json": {
          schema: ListProvidersResponseSchema
        }
      }
    }
  }
});

const createProviderRoute = createRoute({
  method: "post",
  path: "/api/providers",
  tags: ["Providers"],
  summary: "Create provider",
  description: "Creates a new provider record.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateProviderRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Provider created successfully.",
      content: {
        "application/json": {
          schema: ProviderSchema
        }
      }
    },
    404: {
      description: "Not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider could not be created.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const updateProviderRoute = createRoute({
  method: "patch",
  path: "/api/providers/{providerId}",
  tags: ["Providers"],
  summary: "Update provider",
  description: "Updates provider metadata such as API proxy URL and timeout.",
  request: {
    params: providerIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateProviderRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Provider updated successfully.",
      content: {
        "application/json": {
          schema: ProviderSchema
        }
      }
    },
    404: {
      description: "Not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider could not be updated.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const deleteProviderRoute = createRoute({
  method: "delete",
  path: "/api/providers/{providerId}",
  tags: ["Providers"],
  summary: "Delete provider",
  description: "Deletes a provider record and its models.",
  request: {
    params: providerIdParamSchema
  },
  responses: {
    204: {
      description: "Provider deleted successfully."
    },
    404: {
      description: "Not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "The provider cannot be deleted due to associated runs.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider could not be deleted.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const listModelsRoute = createRoute({
  method: "get",
  path: "/api/models",
  tags: ["Providers"],
  summary: "List models",
  description: "Returns all persisted provider models ordered by enabled status and provider.",
  responses: {
    200: {
      description: "Models fetched successfully.",
      content: {
        "application/json": {
          schema: ListModelsResponseSchema
        }
      }
    }
  }
});

const listProviderModelsRoute = createRoute({
  method: "get",
  path: "/api/providers/{providerId}/models",
  tags: ["Providers"],
  summary: "List models for provider",
  description: "Returns persisted models for a single provider.",
  request: {
    params: providerIdParamSchema
  },
  responses: {
    200: {
      description: "Provider models fetched successfully.",
      content: {
        "application/json": {
          schema: ListModelsResponseSchema
        }
      }
    },
    404: {
      description: "The requested provider was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider models could not be loaded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const createProviderModelRoute = createRoute({
  method: "post",
  path: "/api/providers/{providerId}/models",
  tags: ["Providers"],
  summary: "Create provider model",
  description: "Manually adds or enables a provider model without fetching the provider catalog.",
  request: {
    params: providerIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateProviderModelRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Provider model created successfully.",
      content: {
        "application/json": {
          schema: ProviderModelSchema
        }
      }
    },
    404: {
      description: "The requested provider was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider model could not be created.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const createProviderModelByBodyRoute = createRoute({
  method: "post",
  path: "/api/provider-models",
  tags: ["Providers"],
  summary: "Create provider model",
  description: "Manually adds or enables a provider model without fetching the provider catalog.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateProviderModelWithProviderRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Provider model created successfully.",
      content: {
        "application/json": {
          schema: ProviderModelSchema
        }
      }
    },
    404: {
      description: "The requested provider was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider model could not be created.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const fetchProviderCatalogRoute = createRoute({
  method: "post",
  path: "/api/providers/{providerId}/catalog",
  tags: ["Providers"],
  summary: "Fetch provider catalog",
  description: "Fetches the external provider model catalog, persists it, and returns the updated persisted models.",
  request: {
    params: providerIdParamSchema
  },
  responses: {
    200: {
      description: "Provider catalog fetched successfully.",
      content: {
        "application/json": {
          schema: ListModelsResponseSchema
        }
      }
    },
    404: {
      description: "The requested provider was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider catalog could not be fetched.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const validateProviderRoute = createRoute({
  method: "post",
  path: "/api/providers/{providerId}/validate",
  tags: ["Providers"],
  summary: "Validate provider",
  description: "Validates a persisted provider against current local configuration and enabled models.",
  request: {
    params: providerIdParamSchema
  },
  responses: {
    200: {
      description: "Provider validation completed.",
      content: {
        "application/json": {
          schema: ValidateProviderResponseSchema
        }
      }
    },
    404: {
      description: "The requested provider was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider validation could not be completed.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const updateProviderModelRoute = createRoute({
  method: "patch",
  path: "/api/provider-models/{modelId}",
  tags: ["Providers"],
  summary: "Update provider model",
  description: "Updates persisted provider-model selection state.",
  request: {
    params: providerModelIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateProviderModelRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Provider model updated successfully.",
      content: {
        "application/json": {
          schema: ProviderModelSchema
        }
      }
    },
    404: {
      description: "Not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The provider model could not be updated.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const getProviderCredentialRoute = createRoute({
  method: "get",
  path: "/api/provider-credentials/{providerType}",
  tags: ["Providers"],
  summary: "Get provider credential status",
  description: "Returns whether a provider credential is available without exposing the credential value.",
  request: {
    params: providerTypeParamSchema
  },
  responses: {
    200: {
      description: "Provider credential status fetched successfully.",
      content: {
        "application/json": {
          schema: ProviderCredentialStatusSchema
        }
      }
    }
  }
});

const updateProviderCredentialRoute = createRoute({
  method: "put",
  path: "/api/provider-credentials/{providerType}",
  tags: ["Providers"],
  summary: "Update runtime provider credential",
  description: "Updates the running controller's in-memory credential for a provider without returning the credential value.",
  request: {
    params: providerTypeParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateProviderCredentialRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Provider credential updated successfully.",
      content: {
        "application/json": {
          schema: ProviderCredentialStatusSchema
        }
      }
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const clearProviderCredentialRoute = createRoute({
  method: "delete",
  path: "/api/provider-credentials/{providerType}",
  tags: ["Providers"],
  summary: "Clear runtime provider credential",
  description: "Clears the running controller's in-memory credential for a provider. Environment credentials, if present, remain effective.",
  request: {
    params: providerTypeParamSchema
  },
  responses: {
    200: {
      description: "Provider credential cleared successfully.",
      content: {
        "application/json": {
          schema: ProviderCredentialStatusSchema
        }
      }
    }
  }
});

function createProviderErrorResponse(error: unknown) {
  if (error instanceof ChatStorageResolutionError && error.statusCode === 404) {
    return {
      body: createErrorResponse(error.errorCode, error.message),
      status: 404 as const
    };
  }

  providersLogger.error("providers.request_failed", error);

  return {
    body: createErrorResponse("internal_error", "Failed to process the provider request."),
    status: 500 as const
  };
}

function createManualProviderModel(
  options: { getChatStorage: () => ChatStorage; providerRuntime: ProviderRuntime },
  input: {
    providerId: string;
    modelName: string;
    displayName?: string;
    supportsTools?: boolean;
    supportsReasoning?: boolean;
  }
) {
  const model = options.getChatStorage().createProviderModel({
    providerId: input.providerId,
    modelName: input.modelName,
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.supportsTools !== undefined ? { supportsTools: input.supportsTools } : {}),
    ...(input.supportsReasoning !== undefined ? { supportsReasoning: input.supportsReasoning } : {})
  });
  options.providerRuntime.invalidateProviderCache(input.providerId);

  return model;
}

export function registerProviderRoutes(
  app: ControllerApp,
  options: { getChatStorage: () => ChatStorage; providerCredentials: ProviderCredentialRegistry; providerRuntime: ProviderRuntime }
) {
  app.openapi(listProvidersRoute, (context) => {
    return context.json(
      {
        providers: options.getChatStorage().listProviders()
      },
      200
    );
  });

  app.openapi(createProviderRoute, async (context) => {
    try {
      const input = context.req.valid("json");
      const provider = options.getChatStorage().createProvider(input);
      options.providerRuntime.invalidateProviderCache();
      return context.json(provider, 201);
    } catch (error) {
      const response = createProviderErrorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.openapi(updateProviderRoute, async (context) => {
    try {
      const provider = options.getChatStorage().updateProvider(context.req.valid("param").providerId, context.req.valid("json"));
      options.providerRuntime.invalidateProviderCache(provider.id);
      return context.json(provider, 200);
    } catch (error) {
      const response = createProviderErrorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.openapi(deleteProviderRoute, async (context) => {
    try {
      const providerId = context.req.valid("param").providerId;
      options.getChatStorage().deleteProvider(providerId);
      options.providerRuntime.invalidateProviderCache(providerId);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof ChatStorageResolutionError && error.statusCode === 409) {
        return context.json(createErrorResponse(error.errorCode, error.message), 409);
      }

      const response = createProviderErrorResponse(error);
      return context.json(response.body, response.status);
    }
  });

  app.openapi(listModelsRoute, async (context) => {
    return context.json(
      {
        models: options.getChatStorage().listModels()
      },
      200
    );
  });

  app.openapi(listProviderModelsRoute, async (context) => {
    try {
      return context.json(
        {
          models: options.getChatStorage().listModels(context.req.valid("param").providerId)
        },
        200
      );
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(createProviderModelRoute, async (context) => {
    try {
      const providerId = context.req.valid("param").providerId;
      const input = context.req.valid("json");
      const model = createManualProviderModel(options, {
        providerId,
        modelName: input.modelName,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.supportsTools !== undefined ? { supportsTools: input.supportsTools } : {}),
        ...(input.supportsReasoning !== undefined ? { supportsReasoning: input.supportsReasoning } : {})
      });

      return context.json(model, 201);
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(createProviderModelByBodyRoute, async (context) => {
    try {
      const input = context.req.valid("json");
      const model = createManualProviderModel(options, {
        providerId: input.providerId,
        modelName: input.modelName,
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.supportsTools !== undefined ? { supportsTools: input.supportsTools } : {}),
        ...(input.supportsReasoning !== undefined ? { supportsReasoning: input.supportsReasoning } : {})
      });

      return context.json(model, 201);
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(fetchProviderCatalogRoute, async (context) => {
    try {
      const providerId = context.req.valid("param").providerId;

      await options.providerRuntime.syncProviderCatalog(providerId, { force: true });

      return context.json(
        {
          models: options.getChatStorage().listModels(providerId)
        },
        200
      );
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(validateProviderRoute, async (context) => {
    try {
      return context.json(await options.providerRuntime.validateProvider(context.req.valid("param").providerId, { force: true }), 200);
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(updateProviderModelRoute, async (context) => {
    try {
      const model = options.getChatStorage().updateProviderModel({
        modelId: context.req.valid("param").modelId,
        enabled: context.req.valid("json").enabled
      });
      options.providerRuntime.invalidateProviderCache(model.providerId);

      return context.json(model, 200);
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(getProviderCredentialRoute, (context) => {
    return context.json(options.providerCredentials.getStatus(context.req.valid("param").providerType as ProviderCredentialType), 200);
  });

  app.openapi(updateProviderCredentialRoute, (context) => {
    try {
      const providerType = context.req.valid("param").providerType as ProviderCredentialType;
      const status = options.providerCredentials.setRuntimeApiKey(providerType, context.req.valid("json").apiKey);
      options.providerRuntime.invalidateProviderCache();

      return context.json(status, 200);
    } catch (error) {
      return context.json(
        createErrorResponse("invalid_provider_credential", error instanceof Error ? error.message : "Provider credential is invalid."),
        400
      );
    }
  });

  app.openapi(clearProviderCredentialRoute, (context) => {
    const status = options.providerCredentials.clearRuntimeApiKey(context.req.valid("param").providerType as ProviderCredentialType);
    options.providerRuntime.invalidateProviderCache();

    return context.json(status, 200);
  });
}
