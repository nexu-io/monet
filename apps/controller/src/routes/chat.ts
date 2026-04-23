import { validateUIMessages, type UIMessage } from "ai";

import { resolveRunBudget } from "../agent-runtime";
import type { ControllerApp } from "../app";
import { createChatStreamResponse } from "../chat-stream";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import type { AgentRuntimeConfig } from "../config";
import { createLogger } from "../logger";
import { ProviderRuntimeError, type ProviderRuntime } from "../provider-runtime";
import { getRequestId } from "../request-context";
import type { RunRegistry } from "../run-registry";
import type { ToolRegistry } from "../tools/registry";

interface ChatRequestBody {
  readonly messages?: unknown;
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly runtimeOptions?: {
    readonly maxSteps?: number;
  };
}

const chatLogger = createLogger("controller", {
  component: "chat-route"
});

export function registerChatRoutes(
  app: ControllerApp,
  options: {
    getChatStorage: () => ChatStorage;
    providerRuntime: ProviderRuntime;
    runRegistry: RunRegistry;
    toolRegistry: ToolRegistry;
    runtime: AgentRuntimeConfig;
  }
) {
  app.post("/api/chat", async (context) => {
    const requestId = getRequestId(context);
    let body: ChatRequestBody;

    try {
      body = (await context.req.json()) as ChatRequestBody;
    } catch {
      chatLogger.warn("chat.invalid_json", {
        requestId
      });

      return context.json(
        {
          error: "invalid_request",
          message: "Request body must be valid JSON."
        },
        400
      );
    }

    let messages: UIMessage[];

    try {
      messages = await validateUIMessages({
        messages: Array.isArray(body.messages) ? body.messages : []
      });
    } catch {
      chatLogger.warn("chat.invalid_messages", {
        requestId,
        rawMessageCount: Array.isArray(body.messages) ? body.messages.length : 0
      });

      return context.json(
        {
          error: "invalid_request",
          message: "`messages` must be a valid AI SDK UIMessage[] payload."
        },
        400
      );
    }

    const runBudget = resolveRunBudget(
      {
        requestedMaxSteps: body.runtimeOptions?.maxSteps
      },
      options.runtime
    );

    let resolvedChatRequest;

    try {
      resolvedChatRequest = options.getChatStorage().prepareChatRequest({
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        ...(body.providerId ? { providerId: body.providerId } : {}),
        ...(body.modelId ? { modelId: body.modelId } : {}),
        messages,
        maxSteps: runBudget.maxSteps,
        maxTokensPerRun: runBudget.maxTokensPerRun,
        wallClockDeadlineAt: runBudget.wallClockDeadlineAt
      });
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        const status = error.statusCode === 422 ? 422 : 400;

        chatLogger.warn("chat.request_rejected", {
          requestId,
          errorCode: error.errorCode,
          sessionId: body.sessionId,
          providerId: body.providerId,
          modelId: body.modelId,
          status
        });

        return context.json(
          {
            error: error.errorCode,
            message: error.message
          },
          status
        );
      }

      chatLogger.error("chat.prepare_request_failed", error, {
        requestId,
        sessionId: body.sessionId,
        providerId: body.providerId,
        modelId: body.modelId
      });

      return context.json(
        {
          error: "internal_error",
          message: "Failed to persist the chat request."
        },
        500
      );
    }

    try {
      return await createChatStreamResponse({
        request: resolvedChatRequest,
        messages,
        chatStorage: options.getChatStorage(),
        providerRuntime: options.providerRuntime,
        runRegistry: options.runRegistry,
        toolRegistry: options.toolRegistry,
        runtime: options.runtime,
        logger: chatLogger.child({ requestId }),
        requestSignal: context.req.raw.signal
      });
    } catch (error) {
      if (error instanceof ProviderRuntimeError) {
        const status = error.statusCode === 422 ? 422 : 500;

        chatLogger.warn("chat.provider_resolution_failed", {
          requestId,
          runId: resolvedChatRequest.runId,
          providerId: resolvedChatRequest.providerId,
          modelId: resolvedChatRequest.modelId,
          errorCode: error.errorCode,
          status
        });

        options.getChatStorage().failRun({
          runId: resolvedChatRequest.runId,
          finishReason: error.message
        });

        return context.json(
          {
            error: error.errorCode,
            message: error.message
          },
          status
        );
      }

      options.getChatStorage().failRun({
        runId: resolvedChatRequest.runId,
        finishReason: error instanceof Error ? error.message : "provider_runtime_error"
      });

      chatLogger.error("chat.stream_init_failed", error, {
        requestId,
        runId: resolvedChatRequest.runId,
        providerId: resolvedChatRequest.providerId,
        modelId: resolvedChatRequest.modelId
      });

      return context.json(
        {
          error: "internal_error",
          message: "Failed to start the chat stream."
        },
        500
      );
    }
  });
}
