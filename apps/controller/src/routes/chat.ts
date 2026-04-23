import { createId as createCuid2 } from "@paralleldrive/cuid2";
import { stepCountIs, streamText, convertToModelMessages, validateUIMessages, type UIMessage } from "ai";

import {
  countUsageTokens,
  describeRunFinishReason,
  isRunBudgetFinishReason,
  resolveRunBudget,
  shouldCompleteRunForFinishReason,
  shouldInterruptRunForFinishReason,
  type RunFinishReason
} from "../agent-runtime";
import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage, type ResolvedChatRequest } from "../chat-storage";
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

function toModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(messages.map(({ id: _id, ...message }) => message));
}

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

    let resolvedChatRequest: ResolvedChatRequest;

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

    const runtimeLogger = chatLogger.child({
      requestId,
      runId: resolvedChatRequest.runId,
      sessionId: resolvedChatRequest.sessionId,
      providerId: resolvedChatRequest.providerId,
      modelId: resolvedChatRequest.modelId,
      runtimeArea: "tool-runtime"
    });
    const runtimeTools = options.toolRegistry.createRuntimeTools({
      runId: resolvedChatRequest.runId,
      chatStorage: options.getChatStorage(),
      logger: runtimeLogger
    });

    const startedAt = Date.now();
    const abortController = new AbortController();
    let runFinishReason: RunFinishReason | null = null;
    let observedStepCount = 0;
    let observedTokenCount = 0;
    let observedToolCallCount = 0;
    let finalizedRun = false;

    const abortRun = (reason: RunFinishReason) => {
      if (runFinishReason == null) {
        runFinishReason = reason;
      }

      runtimeLogger.warn("chat.run_aborted", {
        currentStep: observedStepCount,
        reason,
        totalTokens: observedTokenCount,
        totalToolCalls: observedToolCallCount
      });

      if (!abortController.signal.aborted) {
        abortController.abort(new Error(describeRunFinishReason(reason)));
      }
    };

    const unregisterRun = options.runRegistry.register(resolvedChatRequest.runId, {
      abort: abortRun
    });

    runtimeLogger.info("chat.run_started", {
      maxSteps: resolvedChatRequest.maxSteps,
      maxTokensPerRun: resolvedChatRequest.maxTokensPerRun,
      maxToolCallsPerRun: options.runtime.maxToolCallsPerRun,
      availableToolCount: Object.keys(runtimeTools).length,
      messageCount: messages.length,
      wallClockDeadlineAt: resolvedChatRequest.wallClockDeadlineAt
    });

    let model: Parameters<typeof streamText>[0]["model"];

    try {
      model = await options.providerRuntime.createChatModel(resolvedChatRequest.providerId, resolvedChatRequest.modelId);
    } catch (error) {
      if (error instanceof ProviderRuntimeError) {
        unregisterRun();

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

      unregisterRun();

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

    const requestSignal = context.req.raw.signal;
    const wallClockDeadlineAt = new Date(resolvedChatRequest.wallClockDeadlineAt ?? runBudget.wallClockDeadlineAt).getTime();
    const wallClockBudgetMs = Math.max(0, wallClockDeadlineAt - startedAt);

    const wallClockTimer =
      wallClockBudgetMs > 0
        ? setTimeout(() => {
            abortRun("wall_clock_budget_exceeded");
          }, wallClockBudgetMs)
        : null;

    const abortRequestHandler = () => {
      abortRun("request_aborted");
    };

    if (requestSignal.aborted) {
      abortRequestHandler();
    } else {
      requestSignal.addEventListener("abort", abortRequestHandler, { once: true });
    }

    const cleanupRunResources = () => {
      unregisterRun();

      if (wallClockTimer) {
        clearTimeout(wallClockTimer);
      }

      requestSignal.removeEventListener("abort", abortRequestHandler);
    };

    const finalizeRun = (status: "completed" | "failed" | "interrupted", finishReason: string | null) => {
      if (finalizedRun) {
        return;
      }

      finalizedRun = true;
      cleanupRunResources();

      if (status === "completed") {
        options.getChatStorage().completeRun({
          runId: resolvedChatRequest.runId,
          finishReason
        });

        runtimeLogger.info("chat.run_completed", {
          currentStep: observedStepCount,
          durationMs: Date.now() - startedAt,
          finishReason
        });

        return;
      }

      if (status === "interrupted") {
        options.getChatStorage().interruptRun({
          runId: resolvedChatRequest.runId,
          finishReason: finishReason ?? "request_aborted"
        });

        runtimeLogger.warn("chat.run_interrupted", {
          currentStep: observedStepCount,
          durationMs: Date.now() - startedAt,
          finishReason: finishReason ?? "request_aborted"
        });

        return;
      }

      options.getChatStorage().failRun({
        runId: resolvedChatRequest.runId,
        finishReason: finishReason ?? "stream_error"
      });

      runtimeLogger.warn("chat.run_failed", {
        currentStep: observedStepCount,
        durationMs: Date.now() - startedAt,
        finishReason: finishReason ?? "stream_error"
      });
    };

    const resolveTerminalStatus = (finishReason: string | null | undefined) => {
      return shouldCompleteRunForFinishReason(finishReason)
        ? "completed"
        : shouldInterruptRunForFinishReason(finishReason)
          ? "interrupted"
          : "failed";
    };

    let result: ReturnType<typeof streamText>;

    try {
      result = streamText({
        model,
        abortSignal: abortController.signal,
        messages: await toModelMessages(messages),
        tools: runtimeTools as NonNullable<Parameters<typeof streamText>[0]["tools"]>,
        stopWhen: [stepCountIs(resolvedChatRequest.maxSteps)],
        onStepFinish: ({ stepNumber, toolCalls, usage }) => {
          const currentStep = stepNumber + 1;

          observedStepCount = Math.max(observedStepCount, currentStep);
          observedTokenCount += countUsageTokens(usage);
          observedToolCallCount += toolCalls.length;

          options.getChatStorage().updateRunProgress({
            runId: resolvedChatRequest.runId,
            currentStep: observedStepCount
          });

          runtimeLogger.info("chat.run_step_finished", {
            stepNumber: currentStep,
            stepToolCalls: toolCalls.length,
            totalTokens: observedTokenCount,
            totalToolCalls: observedToolCallCount
          });

          if (
            typeof resolvedChatRequest.maxTokensPerRun === "number" &&
            observedTokenCount > resolvedChatRequest.maxTokensPerRun
          ) {
            abortRun("token_budget_exceeded");
            return;
          }

          if (observedToolCallCount > options.runtime.maxToolCallsPerRun) {
            abortRun("tool_call_budget_exceeded");
          }
        },
        onAbort: () => {
          try {
            finalizeRun(resolveTerminalStatus(runFinishReason), runFinishReason);
          } catch (error) {
            runtimeLogger.error("chat.abort_finalize_failed", error);
          }
        },
        onFinish: ({ finishReason }) => {
          try {
            finalizeRun("completed", finishReason ?? null);
          } catch (error) {
            runtimeLogger.error("chat.complete_run_failed", error);
          }
        }
      });
    } catch (error) {
      const finishReason = error instanceof Error ? error.message : "stream_error";

      try {
        finalizeRun(resolveTerminalStatus(finishReason), finishReason);
      } catch (persistError) {
        runtimeLogger.error("chat.stream_init_finalize_failed", persistError);
      }

      runtimeLogger.error("chat.stream_init_failed", error, {
        durationMs: Date.now() - startedAt
      });

      return context.json(
        {
          error: "internal_error",
          message: "Failed to start the chat stream."
        },
        500
      );
    }

    void Promise.resolve(result.consumeStream()).catch((error: unknown) => {
      try {
        const finishReason =
          runFinishReason ??
          (error instanceof Error && error.name === "AbortError" ? "request_aborted" : null) ??
          (error instanceof Error ? error.message : "stream_error");

        finalizeRun(resolveTerminalStatus(finishReason), finishReason);
      } catch (persistError) {
        runtimeLogger.error("chat.consume_stream_finalize_failed", persistError);
      }

      runtimeLogger.error("chat.consume_stream_failed", error, {
        durationMs: Date.now() - startedAt
      });
    });

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
          const finishReason =
            runFinishReason ??
            (error instanceof Error && error.name === "AbortError" ? "request_aborted" : null) ??
            (error instanceof Error ? error.message : "stream_error");

          finalizeRun(resolveTerminalStatus(finishReason), finishReason);
        } catch (persistError) {
          runtimeLogger.error("chat.fail_run_persist_failed", persistError);
        }

        runtimeLogger.error("chat.stream_failed", error, {
          durationMs: Date.now() - startedAt
        });

        if (isRunBudgetFinishReason(runFinishReason)) {
          return describeRunFinishReason(runFinishReason);
        }

        return "An error occurred.";
      }
    });
  });
}
