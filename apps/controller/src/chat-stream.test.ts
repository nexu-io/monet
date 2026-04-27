import assert from "node:assert/strict";
import test from "node:test";

import { isExpiredWallClockBudget, isToolCallBudgetExhausted, resolveObservedRunUsage } from "./chat-stream";

test("resolveObservedRunUsage keeps cumulative run usage from prior continuations", () => {
  assert.deepEqual(
    resolveObservedRunUsage({
      consumedTokens: 42,
      consumedToolCalls: 3
    }),
    {
      consumedTokens: 42,
      consumedToolCalls: 3
    }
  );

  assert.deepEqual(
    resolveObservedRunUsage({
      consumedTokens: -1,
      consumedToolCalls: -1
    }),
    {
      consumedTokens: 0,
      consumedToolCalls: 0
    }
  );
});

test("isExpiredWallClockBudget flags already-expired deadlines before streaming starts", () => {
  const startedAt = Date.parse("2026-01-01T00:01:00.000Z");

  assert.equal(isExpiredWallClockBudget(startedAt - 1, startedAt), true);
  assert.equal(isExpiredWallClockBudget(startedAt, startedAt), true);
  assert.equal(isExpiredWallClockBudget(startedAt + 1, startedAt), false);
  assert.equal(isExpiredWallClockBudget(Number.NaN, startedAt), false);
});

test("isToolCallBudgetExhausted aborts once the configured tool-call limit is reached", () => {
  assert.equal(isToolCallBudgetExhausted(0, 1), false);
  assert.equal(isToolCallBudgetExhausted(1, 1), true);
  assert.equal(isToolCallBudgetExhausted(2, 1), true);
});
