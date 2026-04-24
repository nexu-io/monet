import assert from "node:assert/strict";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import type { ChatStorage } from "../chat-storage";
import { createRunRegistry } from "../run-registry";
import { registerChatRoutes } from "./chat";

const noopProviderRuntime = {
  createChatModel() {
    throw new Error("not used in validation test");
  }
};

const noopToolRegistry = {
  listTools() {
    return [] as const;
  },
  register() {
    throw new Error("not used in validation test");
  },
  createRuntimeTools() {
    return {};
  }
};

test("chat endpoint rejects invalid identifier types before storage resolution", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let prepareCalled = false;

  registerChatRoutes(app, {
    runRegistry: createRunRegistry(),
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 8,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 16,
      wallClockBudgetMs: 60_000
    },
    getChatStorage: () =>
      ({
        prepareChatRequest() {
          prepareCalled = true;
          throw new Error("should not be called for invalid requests");
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:3030/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messages: [],
      providerId: { nested: true }
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_request",
    message: "Request validation failed."
  });
  assert.equal(prepareCalled, false);
});

test("chat endpoint rejects non-array messages before storage resolution", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let prepareCalled = false;

  registerChatRoutes(app, {
    runRegistry: createRunRegistry(),
    providerRuntime: noopProviderRuntime as never,
    toolRegistry: noopToolRegistry as never,
    runtime: {
      maxStepsPerRun: 8,
      maxTokensPerRun: 32_768,
      maxToolCallsPerRun: 16,
      wallClockBudgetMs: 60_000
    },
    getChatStorage: () =>
      ({
        prepareChatRequest() {
          prepareCalled = true;
          throw new Error("should not be called for invalid requests");
        }
      }) as unknown as ChatStorage
  });

  const response = await app.request("http://127.0.0.1:3030/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messages: {
        malformed: true
      }
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_request",
    message: "`messages` must be a valid AI SDK UIMessage[] payload."
  });
  assert.equal(prepareCalled, false);
});
