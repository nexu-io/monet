import { createId as createCuid2 } from "@paralleldrive/cuid2";
import { consumeStream, convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import {
  countUsageTokens,
  describeRunFinishReason,
  isRunBudgetFinishReason,
  resolveRunBudget,
  shouldCompleteRunForFinishReason,
  shouldInterruptRunForFinishReason,
  type RunFinishReason
} from "./agent-runtime";
import { buildReplayContext } from "./chat-context";
import type { ChatStorage } from "./chat-storage";
import type { AgentRuntimeConfig } from "./config";
import type { Logger } from "./logger";
import type { ProviderRuntime } from "./provider-runtime";
import type { RunRegistry } from "./run-registry";
import type { SessionWorkspaceService } from "./session-workspace-service";
import type { ToolRegistry } from "./tools/registry";
import { sanitizeUiMessage } from "./ui-message-sanitize";

export interface ChatStreamRequest {
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly runId: string;
  readonly currentStep?: number;
  readonly consumedTokens?: number;
  readonly consumedToolCalls?: number;
  readonly maxSteps: number;
  readonly maxTokensPerRun: number | null;
  readonly wallClockDeadlineAt: string | null;
}

function toModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(messages.map(({ id: _id, ...message }) => message));
}

export function resolveCurrentRunStep(currentStep: number, stepNumber: number) {
  return Math.max(0, currentStep) + stepNumber + 1;
}

export function resolveObservedRunUsage(request: Pick<ChatStreamRequest, "consumedTokens" | "consumedToolCalls">) {
  return {
    consumedTokens: Math.max(0, request.consumedTokens ?? 0),
    consumedToolCalls: Math.max(0, request.consumedToolCalls ?? 0)
  };
}

export function isExpiredWallClockBudget(wallClockDeadlineAt: number, startedAt: number) {
  return Number.isFinite(wallClockDeadlineAt) && wallClockDeadlineAt <= startedAt;
}

export function isToolCallBudgetExhausted(observedToolCallCount: number, maxToolCallsPerRun: number) {
  return observedToolCallCount >= maxToolCallsPerRun;
}

function isApprovalRequestedToolPart(part: unknown): part is {
  readonly toolCallId: string;
  readonly approval: { readonly id: string };
} {
  return (
    typeof part === "object" &&
    part !== null &&
    "state" in part &&
    (part as { state?: unknown }).state === "approval-requested" &&
    typeof (part as { toolCallId?: unknown }).toolCallId === "string" &&
    typeof (part as { approval?: { id?: unknown } }).approval?.id === "string"
  );
}

export async function createChatStreamResponse(options: {
  readonly request: ChatStreamRequest;
  readonly messages: UIMessage[];
  readonly chatStorage: ChatStorage;
  readonly providerRuntime: ProviderRuntime;
  readonly runRegistry: RunRegistry;
  readonly sessionWorkspaceService: SessionWorkspaceService;
  readonly toolRegistry: ToolRegistry;
  readonly runtime: AgentRuntimeConfig;
  readonly logger: Logger;
  readonly requestSignal: AbortSignal;
}) {
  const { request, messages } = options;
  const runtimeLogger = options.logger.child({
    runId: request.runId,
    sessionId: request.sessionId,
    providerId: request.providerId,
    modelId: request.modelId,
    runtimeArea: "tool-runtime"
  });
  const sessionWorkspacePath = await options.sessionWorkspaceService.ensureWorkspace(request.sessionId);
  const startedAt = Date.now();
  const abortController = new AbortController();
  let runFinishReason: RunFinishReason | null = null;
  const persistedCurrentStep = Math.max(0, request.currentStep ?? 0);
  const initialUsage = resolveObservedRunUsage(request);
  let observedStepCount = persistedCurrentStep;
  let observedTokenCount = initialUsage.consumedTokens;
  let observedToolCallCount = initialUsage.consumedToolCalls;
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

  const unregisterRun = options.runRegistry.register(request.runId, {
    abort: abortRun
  });

  const abortRequestHandler = () => {
    abortRun("request_aborted");
  };

  if (options.requestSignal.aborted) {
    abortRequestHandler();
  } else {
    options.requestSignal.addEventListener("abort", abortRequestHandler, { once: true });
  }

  let wallClockTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanupRunResources = () => {
    unregisterRun();

    if (wallClockTimer) {
      clearTimeout(wallClockTimer);
    }

    options.requestSignal.removeEventListener("abort", abortRequestHandler);
  };

  let runtimeTools: Record<string, unknown>;

  try {
    runtimeTools = await options.toolRegistry.createRuntimeTools({
      runId: request.runId,
      sessionId: request.sessionId,
      sessionWorkspacePath,
      chatStorage: options.chatStorage,
      logger: runtimeLogger,
      abortSignal: abortController.signal
    });
  } catch (error) {
    cleanupRunResources();
    throw error;
  }

  runtimeLogger.info("chat.run_started", {
    maxSteps: request.maxSteps,
    maxTokensPerRun: request.maxTokensPerRun,
    maxToolCallsPerRun: options.runtime.maxToolCallsPerRun,
    availableToolCount: Object.keys(runtimeTools).length,
    messageCount: messages.length,
    consumedTokens: observedTokenCount,
    consumedToolCalls: observedToolCallCount,
    wallClockDeadlineAt: request.wallClockDeadlineAt
  });

  let model: Parameters<typeof streamText>[0]["model"];

  try {
    model = await options.providerRuntime.createChatModel(request.providerId, request.modelId);
  } catch (error) {
    cleanupRunResources();
    throw error;
  }

  const effectiveBudget = resolveRunBudget(
    {
      requestedMaxSteps: request.maxSteps
    },
    options.runtime
  );
  const wallClockDeadlineAt = new Date(request.wallClockDeadlineAt ?? effectiveBudget.wallClockDeadlineAt).getTime();
  const wallClockBudgetMs = Math.max(0, wallClockDeadlineAt - startedAt);
  if (wallClockBudgetMs === 0 && isExpiredWallClockBudget(wallClockDeadlineAt, startedAt)) {
    abortRun("wall_clock_budget_exceeded");
  }
  wallClockTimer =
    wallClockBudgetMs > 0
      ? setTimeout(() => {
          abortRun("wall_clock_budget_exceeded");
        }, wallClockBudgetMs)
      : null;

  if (typeof request.maxTokensPerRun === "number" && observedTokenCount >= request.maxTokensPerRun) {
    abortRun("token_budget_exceeded");
  }

  if (isToolCallBudgetExhausted(observedToolCallCount, options.runtime.maxToolCallsPerRun)) {
    abortRun("tool_call_budget_exceeded");
  }

  const finalizeRun = (status: "completed" | "failed" | "interrupted" | "awaiting_confirmation", finishReason: string | null) => {
    if (finalizedRun) {
      return;
    }

    finalizedRun = true;
    cleanupRunResources();

    if (status === "completed") {
      options.chatStorage.completeRun({
        runId: request.runId,
        finishReason
      });

      runtimeLogger.info("chat.run_completed", {
        currentStep: observedStepCount,
        durationMs: Date.now() - startedAt,
        finishReason
      });

      return;
    }

    if (status === "awaiting_confirmation") {
      options.chatStorage.markRunAwaitingConfirmation(request.runId);

      runtimeLogger.info("chat.run_awaiting_confirmation", {
        currentStep: observedStepCount,
        durationMs: Date.now() - startedAt
      });

      return;
    }

    if (status === "interrupted") {
      options.chatStorage.interruptRun({
        runId: request.runId,
        finishReason: finishReason ?? "request_aborted"
      });

      runtimeLogger.warn("chat.run_interrupted", {
        currentStep: observedStepCount,
        durationMs: Date.now() - startedAt,
        finishReason: finishReason ?? "request_aborted"
      });

      return;
    }

    options.chatStorage.failRun({
      runId: request.runId,
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

  const replayContext = buildReplayContext(messages, { sessionWorkspacePath });

  runtimeLogger.info("chat.replay_context_prepared", { ...replayContext.stats });

  const result = streamText({
    model,
    abortSignal: abortController.signal,
    messages: await toModelMessages(replayContext.messages),
    tools: runtimeTools as NonNullable<Parameters<typeof streamText>[0]["tools"]>,
    stopWhen: [stepCountIs(request.maxSteps)],
    onStepFinish: ({ stepNumber, toolCalls, usage }) => {
      const currentStep = resolveCurrentRunStep(persistedCurrentStep, stepNumber);

      observedStepCount = Math.max(observedStepCount, currentStep);
      observedTokenCount += countUsageTokens(usage);
      observedToolCallCount += toolCalls.length;

      options.chatStorage.updateRunProgress({
        runId: request.runId,
        currentStep: observedStepCount,
        consumedTokens: observedTokenCount,
        consumedToolCalls: observedToolCallCount
      });

      runtimeLogger.info("chat.run_step_finished", {
        stepNumber: currentStep,
        stepToolCalls: toolCalls.length,
        totalTokens: observedTokenCount,
        totalToolCalls: observedToolCallCount
      });

      if (typeof request.maxTokensPerRun === "number" && observedTokenCount >= request.maxTokensPerRun) {
        abortRun("token_budget_exceeded");
        return;
      }

      if (isToolCallBudgetExhausted(observedToolCallCount, options.runtime.maxToolCallsPerRun)) {
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
      runtimeLogger.info("chat.stream_finished", {
        currentStep: observedStepCount,
        finishReason: finishReason ?? null,
        durationMs: Date.now() - startedAt
      });
    }
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    consumeSseStream: consumeStream,
    generateMessageId: () => `msg_${createCuid2()}`,
    messageMetadata: () => ({ runId: request.runId }),
    onFinish: ({ responseMessage }) => {
      try {
        const sanitizedResponseMessage = sanitizeUiMessage(responseMessage) ?? responseMessage;
        const approvalRequests = sanitizedResponseMessage.parts.flatMap((part) => (isApprovalRequestedToolPart(part) ? [part] : []));

        options.chatStorage.persistAssistantMessage({
          sessionId: request.sessionId,
          runId: request.runId,
          providerId: request.providerId,
          modelId: request.modelId,
          message: sanitizedResponseMessage
        });

        for (const part of approvalRequests) {
          options.chatStorage.recordToolApprovalRequest({
            toolCallId: part.toolCallId,
            confirmationToken: part.approval.id
          });
        }

        finalizeRun(approvalRequests.length > 0 ? "awaiting_confirmation" : "completed", null);

        runtimeLogger.info("chat.assistant_message_persisted", {
          messageId: responseMessage.id,
          partCount: sanitizedResponseMessage.parts.length,
          approvalRequestCount: approvalRequests.length
        });
      } catch (error) {
        runtimeLogger.error("chat.persist_assistant_message_failed", error);
        finalizeRun("failed", error instanceof Error ? error.message : "persist_assistant_message_failed");
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
}
