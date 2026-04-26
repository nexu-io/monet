import assert from "node:assert/strict";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { createToolRegistry } from "../tools/registry";
import { registerToolRoutes } from "./tools";

test("list tools endpoint returns registered tool metadata", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  const toolRegistry = createToolRegistry([
    {
      metadata: {
        name: "read_file",
        description: "Reads an authorized file.",
        requiresConfirmation: false
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      } as never,
      async execute() {
        return { ok: true };
      }
    }
  ]);

  registerToolRoutes(app, {
    toolRegistry,
    getChatStorage: () => ({}) as never
  });

  const response = await app.request("http://127.0.0.1:42831/api/tools", {
    method: "GET"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tools: [
      {
        name: "read_file",
        description: "Reads an authorized file.",
        requiresConfirmation: false
      }
    ]
  });
});
