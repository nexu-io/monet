import { createId as createCuid2 } from "@paralleldrive/cuid2";
import { streamText, convertToModelMessages, validateUIMessages, type UIMessage } from "ai";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage, type ResolvedChatRequest } from "../chat-storage";
import { createLogger } from "../logger";
import { ProviderRuntimeError, type ProviderRuntime } from "../provider-runtime";
import { getRequestId } from "../request-context";

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

function toModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(messages.map(({ id: _id, ...message }) => message));
}

export function registerChatRoutes(
  app: ControllerApp,
  options: { getChatStorage: () => ChatStorage; providerRuntime: ProviderRuntime }
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

    let resolvedChatRequest: ResolvedChatRequest;

    try {
      resolvedChatRequest = options.getChatStorage().prepareChatRequest({
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        ...(body.providerId ? { providerId: body.providerId } : {}),
        ...(body.modelId ? { modelId: body.modelId } : {}),
        messages,
        ...(body.runtimeOptions?.maxSteps != null ? { maxSteps: body.runtimeOptions.maxSteps } : {})
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

    const runtimeLogger = chatLogger.child({
      requestId,
      runId: resolvedChatRequest.runId,
      sessionId: resolvedChatRequest.sessionId,
      providerId: resolvedChatRequest.providerId,
      modelId: resolvedChatRequest.modelId,
      runtimeArea: "tool-runtime"
    });

    const startedAt = Date.now();

    runtimeLogger.info("chat.run_started", {
      maxSteps: body.runtimeOptions?.maxSteps ?? null,
      messageCount: messages.length
    });

    let model: Parameters<typeof streamText>[0]["model"];

    try {
      model = await options.providerRuntime.createChatModel(resolvedChatRequest.providerId, resolvedChatRequest.modelId);
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

      chatLogger.error("chat.provider_resolution_unhandled", error, {
        requestId,
        runId: resolvedChatRequest.runId,
        providerId: resolvedChatRequest.providerId,
        modelId: resolvedChatRequest.modelId
      });

      return context.json(
        {
          error: "internal_error",
          message: "Failed to initialize the provider model."
        },
        500
      );
    }

    const result = streamText({
      model,
      messages: await toModelMessages(messages),
      onFinish: ({ finishReason }) => {
        try {
          options.getChatStorage().completeRun({
            runId: resolvedChatRequest.runId,
            finishReason: finishReason ?? null
          });

          runtimeLogger.info("chat.run_completed", {
            durationMs: Date.now() - startedAt,
            finishReason: finishReason ?? null
          });
        } catch (error) {
          runtimeLogger.error("chat.complete_run_failed", error);
        }
      }
    });

    result.consumeStream();

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: () => `msg_${createCuid2()}`,
      onFinish: ({ responseMessage }) => {
        try {
          options.getChatStorage().persistAssistantMessage({
            sessionId: resolvedChatRequest.sessionId,
            runId: resolvedChatRequest.runId,
            providerId: resolvedChatRequest.providerId,
            modelId: resolvedChatRequest.modelId,
            message: responseMessage
          });

          runtimeLogger.info("chat.assistant_message_persisted", {
            messageId: responseMessage.id,
            partCount: responseMessage.parts.length
          });
        } catch (error) {
          runtimeLogger.error("chat.persist_assistant_message_failed", error);
        }
      },
      onError: (error) => {
        try {
          options.getChatStorage().failRun({
            runId: resolvedChatRequest.runId,
            finishReason: error instanceof Error ? error.message : "stream_error"
          });
        } catch (persistError) {
          runtimeLogger.error("chat.fail_run_persist_failed", persistError);
        }

        runtimeLogger.error("chat.stream_failed", error, {
          durationMs: Date.now() - startedAt
        });

        return "An error occurred.";
      }
    });
  });
}
