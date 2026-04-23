import { OpenAPIHono } from "@hono/zod-openapi";

import { createChatStorage } from "./chat-storage";
import { createRequestId, createLogger } from "./logger";
import { createLocalAuthMiddleware } from "./middleware/local-auth";
import { createProviderRuntime } from "./provider-runtime";
import { getRequestId, requestIdKey } from "./request-context";
import { registerChatRoutes } from "./routes/chat";
import { registerHealthRoutes } from "./routes/health";
import { registerProviderRoutes } from "./routes/providers";
import { registerRunRoutes } from "./routes/runs";
import { registerSessionRoutes } from "./routes/sessions";
import { registerToolRoutes } from "./routes/tools";
import { createRunRegistry } from "./run-registry";
import { createToolRegistry } from "./tools/registry";
import type { AgentRuntimeConfig, OpenAIProviderConfig } from "./config";

export interface CreateControllerAppOptions {
  readonly allowedOrigins: readonly string[];
  readonly agentRuntime: AgentRuntimeConfig;
  readonly bearerToken: string;
  readonly databasePath: string;
  readonly openai: OpenAIProviderConfig;
  readonly port: number;
}

export interface ControllerAppVariables {
  readonly requestId: string;
}

export type ControllerApp = OpenAPIHono<{ Variables: ControllerAppVariables }>;

const controllerLogger = createLogger("controller", {
  component: "http"
});

export function createControllerApp(options: CreateControllerAppOptions): ControllerApp {
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
    }
  });
  const providerRuntime = createProviderRuntime({
    getChatStorage,
    openai: options.openai
  });
  const runRegistry = createRunRegistry();
  const toolRegistry = createToolRegistry();
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

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: options.allowedOrigins,
      bearerToken: options.bearerToken,
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
        name: "Runs",
        description: "Run lifecycle endpoints such as interruption."
      },
      {
        name: "Tools",
        description: "In-process tool registry and confirmation endpoints."
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
    databasePath: options.databasePath,
    interruptedRunCount: recoveredRuns.interruptedRunIds.length,
    failedPendingRunCount: recoveredRuns.failedRunIds.length,
    port: options.port
  });

  registerHealthRoutes(app);
  registerChatRoutes(app, { getChatStorage, providerRuntime, runRegistry, toolRegistry, runtime: options.agentRuntime });
  registerRunRoutes(app, { getChatStorage, runRegistry });
  registerSessionRoutes(app, { getChatStorage });
  registerProviderRoutes(app, { getChatStorage, providerRuntime });
  registerToolRoutes(app, { toolRegistry });

  return app;
}
