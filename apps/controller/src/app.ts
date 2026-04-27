import { OpenAPIHono } from "@hono/zod-openapi";

import { createChatStorage } from "./chat-storage";
import { ComposioConnectorProvider } from "./connectors/composio-provider";
import { createConnectorService } from "./connectors/service";
import { createRequestId, createLogger } from "./logger";
import { createLocalAuthMiddleware } from "./middleware/local-auth";
import { createProviderCredentialRegistry } from "./provider-credentials";
import { createProviderRuntime } from "./provider-runtime";
import { getRequestId, requestIdKey } from "./request-context";
import { registerChatRoutes } from "./routes/chat";
import { registerConnectorRoutes } from "./routes/connectors";
import { registerHealthRoutes } from "./routes/health";
import { registerProviderRoutes } from "./routes/providers";
import { registerRunRoutes } from "./routes/runs";
import { registerSettingsRoutes } from "./routes/settings";
import { registerSessionRoutes } from "./routes/sessions";
import { registerToolRoutes } from "./routes/tools";
import { createRunRegistry } from "./run-registry";
import { createBuiltinToolDefinitions } from "./tools/builtins";
import { createToolRegistry } from "./tools/registry";
import type {
  AgentRuntimeConfig,
  ConnectorProviderConfig,
  FeatureConfig,
  OpenAIProviderConfig,
  OpenRouterProviderConfig
} from "./config";

export interface CreateControllerAppOptions {
  readonly allowedOrigins: readonly string[];
  readonly allowedToolDirectories: readonly string[];
  readonly allowedToolDirectoriesSource: "default" | "env";
  readonly agentRuntime: AgentRuntimeConfig;
  readonly bearerToken: string;
  readonly databasePath: string;
  readonly connectorProvider: ConnectorProviderConfig;
  readonly features: FeatureConfig;
  readonly openai: OpenAIProviderConfig;
  readonly openrouter: OpenRouterProviderConfig;
  readonly port: number;
}

export interface ControllerAppVariables {
  readonly requestId: string;
}

export type ControllerApp = OpenAPIHono<{ Variables: ControllerAppVariables }>;

export interface ControllerAppRuntime {
  readonly app: ControllerApp;
  readonly chatStorage: ReturnType<typeof createChatStorage>;
  readonly setPort: (port: number) => void;
}

const controllerLogger = createLogger("controller", {
  component: "http"
});

export function createControllerApp(options: CreateControllerAppOptions): ControllerAppRuntime {
  let controllerPort = options.port;
  const app = new OpenAPIHono<{ Variables: ControllerAppVariables }>({
    defaultHook(result, context) {
      if (result.success) {
        return;
      }

      controllerLogger.warn("request.validation_failed", {
        method: context.req.method,
        path: context.req.path,
        requestId: getRequestId(context),
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.join(".")
        }))
      });

      return context.json(
        {
          error: "invalid_request",
          message: "Request validation failed."
        },
        400
      );
    }
  });
  const chatStorage = createChatStorage({
    databasePath: options.databasePath,
    openai: {
      baseUrl: options.openai.baseUrl,
      defaultModel: options.openai.defaultModel,
      timeoutMs: options.openai.timeoutMs
    },
    openrouter: {
      baseUrl: options.openrouter.baseUrl,
      defaultModel: options.openrouter.defaultModel,
      timeoutMs: options.openrouter.timeoutMs
    }
  });
  const providerCredentials = createProviderCredentialRegistry({
    openai: options.openai,
    openrouter: options.openrouter
  });
  const providerRuntime = createProviderRuntime({
    getChatStorage,
    openai: options.openai,
    openrouter: options.openrouter,
    providerCredentials
  });
  const connectorProvider = new ComposioConnectorProvider({
    config: options.connectorProvider.composio,
    storage: chatStorage
  });
  const connectorService = createConnectorService({ provider: connectorProvider });
  const persistedAllowedDirectories = chatStorage.listAuthorizedDirectories().map((entry) => entry.path);
  const effectiveAllowedToolDirectories =
    options.allowedToolDirectoriesSource === "env"
      ? options.allowedToolDirectories
      : persistedAllowedDirectories.length > 0
        ? persistedAllowedDirectories
        : options.allowedToolDirectories;

  chatStorage.replaceAuthorizedDirectories(effectiveAllowedToolDirectories);
  const runRegistry = createRunRegistry();
  const toolRegistry = createToolRegistry(
    createBuiltinToolDefinitions({
      allowedDirectories: effectiveAllowedToolDirectories,
      getAllowedDirectories: () => chatStorage.listAuthorizedDirectories().map((entry) => entry.path),
      getControllerPort: () => controllerPort
    }),
    { features: options.features }
  );
  const recoveredRuns = chatStorage.recoverUnfinishedRuns();

  function getChatStorage() {
    return chatStorage;
  }

  app.use("*", async (context, next) => {
    const requestId = createRequestId();
    const startedAt = Date.now();

    context.set(requestIdKey, requestId);
    context.header("x-request-id", requestId);

    try {
      await next();
    } finally {
      const logContext = {
        requestId,
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Date.now() - startedAt
      };

      if (context.res.status >= 500) {
        controllerLogger.error("request.completed", undefined, logContext);
      } else if (context.res.status >= 400) {
        controllerLogger.warn("request.completed", logContext);
      } else {
        controllerLogger.info("request.completed", logContext);
      }
    }
  });

  if (!options.features.connectors) {
    app.use("/connectors/oauth/callback/*", async (context) => {
      return context.json(
        {
          error: "not_found",
          message: "Route not found."
        },
        404
      );
    });
    app.use("/api/connectors", async (context) => {
      return context.json(
        {
          error: "not_found",
          message: "Route not found."
        },
        404
      );
    });
    app.use("/api/connectors/*", async (context) => {
      return context.json(
        {
          error: "not_found",
          message: "Route not found."
        },
        404
      );
    });
  }

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: options.allowedOrigins,
      bearerToken: options.bearerToken,
      getPort: () => controllerPort,
      port: options.port
    })
  );

  app.doc("/api/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Monet Controller API",
      version: "0.1.0",
      description: "Local Hono controller API for the Monet desktop application."
    },
    tags: [
      {
        name: "System",
        description: "Health and controller metadata endpoints."
      },
      {
        name: "Sessions",
        description: "Session lifecycle and history endpoints."
      },
      {
        name: "Providers",
        description: "Provider, model catalog, and validation endpoints."
      },
      {
        name: "Settings",
        description: "General settings endpoints for authorized directories and local runtime metadata."
      },
      {
        name: "Runs",
        description: "Run lifecycle endpoints such as interruption."
      },
      {
        name: "Tools",
        description: "In-process tool registry and confirmation endpoints."
      },
      {
        name: "Connectors",
        description: "External account connectors and connection status endpoints."
      }
    ]
  });

  app.notFound((context) => {
    controllerLogger.warn("request.not_found", {
      requestId: getRequestId(context),
      method: context.req.method,
      path: context.req.path
    });

    return context.json(
      {
        error: "not_found",
        message: "Route not found."
      },
      404
    );
  });

  app.onError((error, context) => {
    controllerLogger.error("request.unhandled_error", error, {
      requestId: getRequestId(context),
      method: context.req.method,
      path: context.req.path
    });

    return context.json(
      {
        error: "internal_error",
        message: "The controller failed to process the request."
      },
      500
    );
  });

  controllerLogger.info("controller.app_created", {
    hasAllowedOrigins: options.allowedOrigins.length > 0,
    allowedToolDirectoryCount: effectiveAllowedToolDirectories.length,
    databasePath: options.databasePath,
    features: {
      connectors: options.features.connectors
    },
    interruptedRunCount: recoveredRuns.interruptedRunIds.length,
    failedPendingRunCount: recoveredRuns.failedRunIds.length,
    port: options.port
  });

  registerHealthRoutes(app);
  registerChatRoutes(app, { getChatStorage, providerRuntime, runRegistry, toolRegistry, runtime: options.agentRuntime });
  registerRunRoutes(app, { getChatStorage, runRegistry, providerRuntime, toolRegistry, runtime: options.agentRuntime });
  registerSessionRoutes(app, { getChatStorage });
  registerProviderRoutes(app, { getChatStorage, providerCredentials, providerRuntime });
  registerSettingsRoutes(app, { getChatStorage });
  registerToolRoutes(app, { toolRegistry, getChatStorage });
  registerConnectorRoutes(app, { connectorService, getChatStorage });

  return {
    app,
    chatStorage,
    setPort(port) {
      controllerPort = port;
    }
  };
}
