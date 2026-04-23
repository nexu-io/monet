import { createRoute, z } from "@hono/zod-openapi";
import { validateUIMessages, type UIMessage } from "ai";

import type { ControllerApp } from "../app";
import { createChatStreamResponse } from "../chat-stream";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import {
  ConfirmToolRequestSchema,
  ErrorResponseSchema,
  StopRunResponseSchema,
  createErrorResponse
} from "../openapi";
import { ProviderRuntimeError, type ProviderRuntime } from "../provider-runtime";
import type { RunRegistry } from "../run-registry";
import type { ToolRegistry } from "../tools/registry";
import type { AgentRuntimeConfig } from "../config";
import { getRequestId } from "../request-context";

const runsLogger = createLogger("controller", {
  component: "runs-route"
});

const runIdParamSchema = z.object({
  runId: z.string().openapi({ example: "run_123" })
});

const continueRunRequestSchema = ConfirmToolRequestSchema.extend({
  messages: z.array(z.unknown()).optional()
});

const stopRunRoute = createRoute({
  method: "post",
  path: "/api/runs/{runId}/stop",
  tags: ["Runs"],
  summary: "Stop run",
  description: "Requests interruption of an in-flight run and marks unfinished persisted state as interrupted.",
  request: {
    params: runIdParamSchema
  },
  responses: {
    200: {
      description: "Run stop was accepted.",
      content: {
        "application/json": {
          schema: StopRunResponseSchema
        }
      }
    },
    404: {
      description: "The requested run was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The run could not be stopped.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

export function registerRunRoutes(
  app: ControllerApp,
  options: {
    getChatStorage: () => ChatStorage;
    runRegistry: RunRegistry;
    providerRuntime: ProviderRuntime;
    toolRegistry: ToolRegistry;
    runtime: AgentRuntimeConfig;
  }
) {
  app.openapi(stopRunRoute, (context) => {
    const { runId } = context.req.valid("param");

    try {
      if (options.runRegistry.stop(runId)) {
        return context.json({ ok: true as const }, 200);
      }

      const result = options.getChatStorage().interruptRun({
        runId,
        finishReason: "stop_requested"
      });

      if (result === "not_found") {
        return context.json(createErrorResponse("not_found", "Run not found."), 404);
      }

      return context.json({ ok: true as const }, 200);
    } catch (error) {
      runsLogger.error("runs.stop_failed", error, {
        runId
      });

      return context.json(createErrorResponse("internal_error", "Failed to stop the run."), 500);
    }
  });

  app.post("/api/runs/:runId/continue", async (context) => {
    const requestId = getRequestId(context);
    const runId = context.req.param("runId");
    let body: z.infer<typeof continueRunRequestSchema>;

    try {
      body = continueRunRequestSchema.parse(await context.req.json());
    } catch {
      return context.json(createErrorResponse("invalid_request", "Request validation failed."), 400);
    }

    if (body.runId !== runId) {
      return context.json(createErrorResponse("invalid_request", "Body runId must match path runId."), 400);
    }

    let messages: UIMessage[];

    try {
      messages = await validateUIMessages({
        messages: Array.isArray(body.messages) ? body.messages : []
      });
    } catch {
      return context.json(createErrorResponse("invalid_request", "`messages` must be a valid AI SDK UIMessage[] payload."), 400);
    }

    try {
      options.getChatStorage().confirmToolCall(body);

      const run = options.getChatStorage().getRunContext(runId);

      if (run.status !== "pending") {
        return context.json(createErrorResponse("invalid_state", "Run is not awaiting continuation."), 409);
      }

      options.getChatStorage().persistRunMessages({
        sessionId: run.sessionId,
        runId,
        messages
      });
      options.getChatStorage().resumeRun(runId);

      return await createChatStreamResponse({
        request: {
          sessionId: run.sessionId,
          providerId: run.providerId,
          modelId: run.modelId,
          runId,
          maxSteps: Math.max(1, run.maxSteps - Math.max(0, run.currentStep)),
          maxTokensPerRun: run.maxTokensPerRun,
          wallClockDeadlineAt: run.wallClockDeadlineAt
        },
        messages,
        chatStorage: options.getChatStorage(),
        providerRuntime: options.providerRuntime,
        runRegistry: options.runRegistry,
        toolRegistry: options.toolRegistry,
        runtime: options.runtime,
        logger: runsLogger.child({ requestId }),
        requestSignal: context.req.raw.signal
      });
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        return context.json(createErrorResponse(error.errorCode, error.message), error.statusCode as 400 | 403 | 404 | 409);
      }

      if (error instanceof ProviderRuntimeError) {
        options.getChatStorage().failRun({
          runId,
          finishReason: error.message
        });

        return context.json(createErrorResponse(error.errorCode, error.message), error.statusCode === 422 ? 422 : 500);
      }

      runsLogger.error("runs.continue_failed", error, {
        requestId,
        runId,
        toolCallId: body.toolCallId
      });

      return context.json(createErrorResponse("internal_error", "Failed to continue the run."), 500);
    }
  });
}
