import assert from "node:assert/strict";
import test from "node:test";

import { OpenAPIHono } from "@hono/zod-openapi";

import type { ControllerApp, ControllerAppVariables } from "../app";
import { LIVE_ARTIFACT_REFRESH_PHASE_GATE, registerLiveArtifactRoutes } from "./live-artifacts";

test("live artifact refresh routes are disabled by the static-only phase gate", async () => {
  const app: ControllerApp = new OpenAPIHono<{ Variables: ControllerAppVariables }>();
  let storageAccesses = 0;

  registerLiveArtifactRoutes(app, {
    getChatStorage() {
      storageAccesses += 1;
      throw new Error("refresh gate should not touch storage or execute tools");
    }
  });

  const artifactRefreshResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts/art_123/refresh", {
    method: "POST"
  });
  const tileRefreshResponse = await app.request("http://127.0.0.1:42831/api/live-artifacts/art_123/tiles/til_123/refresh", {
    method: "POST"
  });

  assert.equal(LIVE_ARTIFACT_REFRESH_PHASE_GATE.enabled, false);
  assert.equal(artifactRefreshResponse.status, 501);
  assert.equal(tileRefreshResponse.status, 501);
  assert.equal(storageAccesses, 0);

  assert.deepEqual(await artifactRefreshResponse.json(), {
    error: LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
    message: LIVE_ARTIFACT_REFRESH_PHASE_GATE.message,
    disabled: true
  });
  assert.deepEqual(await tileRefreshResponse.json(), {
    error: LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
    message: LIVE_ARTIFACT_REFRESH_PHASE_GATE.message,
    disabled: true
  });
});
