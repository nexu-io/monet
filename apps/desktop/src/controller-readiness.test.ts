import assert from "node:assert/strict";
import test from "node:test";

import { waitForControllerReady } from "./controller-readiness";

test("waitForControllerReady accepts a healthy controller response", async () => {
  let observedAuthorizationHeader: string | null = null;

  await waitForControllerReady("http://127.0.0.1:3030", "token", {
    attempts: 1,
    fetchImpl: async (_input, init) => {
      observedAuthorizationHeader = new Headers(init?.headers).get("authorization");
      return new Response(null, {
        status: 200
      });
    }
  });

  assert.equal(observedAuthorizationHeader, "Bearer token");
});

test("waitForControllerReady aborts a stalled healthcheck attempt and retries", async () => {
  let callCount = 0;

  await waitForControllerReady("http://127.0.0.1:3030", "token", {
    attempts: 2,
    attemptTimeoutMs: 10,
    intervalMs: 0,
    fetchImpl: async (_input, init) => {
      callCount += 1;

      if (callCount === 1) {
        const signal = init?.signal;

        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }

      return new Response(null, {
        status: 200
      });
    }
  });

  assert.equal(callCount, 2);
});
