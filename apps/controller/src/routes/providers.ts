import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import {
  ErrorResponseSchema,
  ListModelsResponseSchema,
  ListProvidersResponseSchema,
  ValidateProviderResponseSchema,
  createErrorResponse
} from "../openapi";

const providersLogger = createLogger("controller", {
  component: "providers-route"
});

const providerIdParamSchema = z.object({
  providerId: z.string().trim().min(1).openapi({ example: "pro_b6m4q2r8t5v9x3z7k1n4p6s8" })
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

export function registerProviderRoutes(app: ControllerApp, options: { getChatStorage: () => ChatStorage }) {
  app.openapi(listProvidersRoute, (context) => {
    return context.json(
      {
        providers: options.getChatStorage().listProviders()
      },
      200
    );
  });

  app.openapi(listModelsRoute, (context) => {
    return context.json(
      {
        models: options.getChatStorage().listModels()
      },
      200
    );
  });

  app.openapi(listProviderModelsRoute, (context) => {
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

  app.openapi(validateProviderRoute, (context) => {
    try {
      return context.json(options.getChatStorage().validateProvider(context.req.valid("param").providerId), 200);
    } catch (error) {
      const response = createProviderErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });
}
