import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { clearRuntimeChildOnExit, sendUtilityProcessSignal, waitForUtilityProcessExit } from "./controller-process";

test("clearRuntimeChildOnExit removes the exited child from runtime state", () => {
  const child = { pid: 123 };
  const otherChild = { pid: 456 };
  const runtime = {
    apiBase: "http://127.0.0.1:42831",
    bearerToken: "token",
    managed: true,
    child
  };

  assert.deepEqual(clearRuntimeChildOnExit(runtime, child), {
    apiBase: "http://127.0.0.1:42831",
    bearerToken: "token",
    managed: true
  });
  assert.equal(clearRuntimeChildOnExit(runtime, otherChild), runtime);
  assert.equal(clearRuntimeChildOnExit(null, child), null);
});

test("sendUtilityProcessSignal uses the provided signal and ignores missing processes", () => {
  const signals: NodeJS.Signals[] = [];

  const sent = sendUtilityProcessSignal(123, "SIGKILL", (_pid, signal) => {
    signals.push(signal);
  });
  assert.equal(sent, true);
  assert.deepEqual(signals, ["SIGKILL"]);

  const missingProcess = sendUtilityProcessSignal(456, "SIGTERM", () => {
    const error = new Error("missing process") as NodeJS.ErrnoException;
    error.code = "ESRCH";
    throw error;
  });
  assert.equal(missingProcess, false);
});

test("waitForUtilityProcessExit resolves when exit is observed after the wait starts", async () => {
  const child = new EventEmitter();
  const exitPromise = waitForUtilityProcessExit(child, 100);

  child.emit("exit");

  assert.equal(await exitPromise, true);
});
