import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import type { ChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import { ErrorResponseSchema, StopRunResponseSchema, createErrorResponse } from "../openapi";
import type { RunRegistry } from "../run-registry";

const runsLogger = createLogger("controller", {
  component: "runs-route"
});

const runIdParamSchema = z.object({
  runId: z.string().openapi({ example: "run_123" })
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
  options: { getChatStorage: () => ChatStorage; runRegistry: RunRegistry }
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
}
