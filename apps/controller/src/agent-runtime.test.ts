import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeConfig } from "./config";
import {
  countUsageTokens,
  isRunBudgetFinishReason,
  resolveRunBudget,
  shouldCompleteRunForFinishReason
} from "./agent-runtime";

const runtimeConfig: AgentRuntimeConfig = {
  maxStepsPerRun: 8,
  maxTokensPerRun: 32_768,
  maxToolCallsPerRun: 16,
  wallClockBudgetMs: 60_000
};

test("clamps requested maxSteps to configured maximum", () => {
  const budget = resolveRunBudget({ requestedMaxSteps: 20 }, runtimeConfig);

  assert.equal(budget.maxSteps, runtimeConfig.maxStepsPerRun);
});

test("falls back to configured maxSteps for invalid or undefined requests", () => {
  const undefinedBudget = resolveRunBudget({}, runtimeConfig);
  const invalidBudget = resolveRunBudget({ requestedMaxSteps: -3 }, runtimeConfig);

  assert.equal(undefinedBudget.maxSteps, runtimeConfig.maxStepsPerRun);
  assert.equal(invalidBudget.maxSteps, runtimeConfig.maxStepsPerRun);
});

test("derives wallClockDeadlineAt from provided Date", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const budget = resolveRunBudget({ requestedMaxSteps: 2 }, runtimeConfig, now);

  assert.equal(budget.wallClockDeadlineAt, "2026-01-01T00:01:00.000Z");
});

test("countUsageTokens prefers totalTokens then sums token fields", () => {
  const preferred = countUsageTokens({
    totalTokens: 99,
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 30
  });
  const summed = countUsageTokens({
    totalTokens: null,
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 30
  });

  assert.equal(preferred, 99);
  assert.equal(summed, 60);
});

test("finish-reason helpers classify completion vs failure", () => {
  assert.equal(isRunBudgetFinishReason("token_budget_exceeded"), true);
  assert.equal(isRunBudgetFinishReason("request_aborted"), true);
  assert.equal(isRunBudgetFinishReason("not_a_reason"), false);

  assert.equal(shouldCompleteRunForFinishReason("token_budget_exceeded"), true);
  assert.equal(shouldCompleteRunForFinishReason("tool_call_budget_exceeded"), true);
  assert.equal(shouldCompleteRunForFinishReason("wall_clock_budget_exceeded"), true);
  assert.equal(shouldCompleteRunForFinishReason("request_aborted"), false);
  assert.equal(shouldCompleteRunForFinishReason("not_a_reason"), false);
});
