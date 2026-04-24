import assert from "node:assert/strict";
import test from "node:test";

import { waitForRendererReady } from "./renderer-readiness";

test("waitForRendererReady aborts stalled probes and eventually times out", async () => {
  let attempts = 0;

  await assert.rejects(
    waitForRendererReady("http://127.0.0.1:3000", {
      attempts: 2,
      attemptTimeoutMs: 5,
      intervalMs: 0,
      fetchImpl: async (_input, init) => {
        attempts += 1;

        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          }, { once: true });
        });
      }
    }),
    /Timed out waiting for renderer readiness/
  );

  assert.equal(attempts, 2);
});
