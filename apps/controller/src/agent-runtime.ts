import type { AgentRuntimeConfig } from "./config";

export type RunFinishReason =
  | "request_aborted"
  | "token_budget_exceeded"
  | "tool_call_budget_exceeded"
  | "wall_clock_budget_exceeded";

export interface ResolvedRunBudget {
  readonly maxSteps: number;
  readonly maxTokensPerRun: number;
  readonly maxToolCallsPerRun: number;
  readonly wallClockBudgetMs: number;
  readonly wallClockDeadlineAt: string;
}

export function resolveRunBudget(
  options: {
    readonly requestedMaxSteps?: number | undefined;
  },
  config: AgentRuntimeConfig,
  now: Date = new Date()
): ResolvedRunBudget {
  return {
    maxSteps: clampPositiveInteger(options.requestedMaxSteps, config.maxStepsPerRun),
    maxTokensPerRun: config.maxTokensPerRun,
    maxToolCallsPerRun: config.maxToolCallsPerRun,
    wallClockBudgetMs: config.wallClockBudgetMs,
    wallClockDeadlineAt: new Date(now.getTime() + config.wallClockBudgetMs).toISOString()
  };
}

export function countUsageTokens(
  usage:
    | {
        readonly totalTokens?: number | null | undefined;
        readonly inputTokens?: number | null | undefined;
        readonly outputTokens?: number | null | undefined;
        readonly reasoningTokens?: number | null | undefined;
      }
    | null
    | undefined
) {
  if (!usage) {
    return 0;
  }

  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
    return usage.totalTokens;
  }

  return [usage.inputTokens, usage.outputTokens, usage.reasoningTokens].reduce<number>((total, value) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return total + value;
    }

    return total;
  }, 0);
}

export function isRunBudgetFinishReason(reason: string | null | undefined): reason is RunFinishReason {
  return (
    reason === "request_aborted" ||
    reason === "token_budget_exceeded" ||
    reason === "tool_call_budget_exceeded" ||
    reason === "wall_clock_budget_exceeded"
  );
}

export function shouldCompleteRunForFinishReason(reason: string | null | undefined) {
  return (
    reason === "token_budget_exceeded" ||
    reason === "tool_call_budget_exceeded" ||
    reason === "wall_clock_budget_exceeded"
  );
}

export function describeRunFinishReason(reason: RunFinishReason) {
  switch (reason) {
    case "request_aborted":
      return "Request aborted before the run could complete.";
    case "token_budget_exceeded":
      return "Run token budget exceeded.";
    case "tool_call_budget_exceeded":
      return "Run tool-call budget exceeded.";
    case "wall_clock_budget_exceeded":
      return "Run wall-clock budget exceeded.";
  }
}

function clampPositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return fallback;
  }

  const normalizedValue = value as number;

  return Math.min(normalizedValue, fallback);
}
