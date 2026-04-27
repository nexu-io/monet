import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openWorkspaceDirectoryForSession } from "./open-workspace-directory";

function createRuntime() {
  return {
    apiBase: "http://127.0.0.1:42831",
    bearerToken: "token"
  };
}

function workspaceFetch(workspacePath: string): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        ok: true,
        workspacePath
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
}

test("openWorkspaceDirectory reports unsupported environments without native side effects", async () => {
  let fetched = false;
  let created = false;
  let opened = false;

  const result = await openWorkspaceDirectoryForSession({
    sessionId: "ses_missing_runtime",
    runtime: null,
    fetchImpl: (async () => {
      fetched = true;
      throw new Error("should not fetch");
    }) as typeof fetch,
    mkdirWorkspace: async () => {
      created = true;
    },
    openPath: async () => {
      opened = true;
      return "";
    }
  });

  assert.deepEqual(result, {
    opened: false,
    error: "The Monet controller is not available."
  });
  assert.equal(fetched, false);
  assert.equal(created, false);
  assert.equal(opened, false);
});

test("openWorkspaceDirectory creates missing directories before opening them", async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "monet-open-workspace-tests-"));
  const workspacePath = path.join(fixtureDir, "session-workspace");
  const openedPaths: string[] = [];

  try {
    assert.equal(existsSync(workspacePath), false);

    const result = await openWorkspaceDirectoryForSession({
      sessionId: "ses_create_workspace",
      runtime: createRuntime(),
      fetchImpl: workspaceFetch(workspacePath),
      mkdirWorkspace: mkdir,
      openPath: async (targetPath) => {
        assert.equal(existsSync(targetPath), true);
        openedPaths.push(targetPath);
        return "";
      }
    });

    assert.deepEqual(result, {
      opened: true,
      path: workspacePath
    });
    assert.deepEqual(openedPaths, [workspacePath]);
    assert.equal(existsSync(workspacePath), true);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("openWorkspaceDirectory opens the workspace for each requested desktop session", async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "monet-open-workspace-tests-"));
  const workspacePathBySession = new Map([
    ["ses_desktop_ui_one", path.join(fixtureDir, "session-one")],
    ["ses_desktop_ui_two", path.join(fixtureDir, "session-two")]
  ]);
  const requestedSessionIds: string[] = [];
  const openedPaths: string[] = [];

  try {
    const fetchImpl: typeof fetch = async (input) => {
      const requestUrl = new URL(input.toString());
      const match = requestUrl.pathname.match(/^\/api\/sessions\/([^/]+)\/workspace\/open$/);
      assert.ok(match, `unexpected workspace open URL: ${requestUrl.pathname}`);

      const sessionId = decodeURIComponent(match[1] ?? "");
      requestedSessionIds.push(sessionId);
      const workspacePath = workspacePathBySession.get(sessionId);
      assert.ok(workspacePath, `unexpected session ID: ${sessionId}`);

      return new Response(
        JSON.stringify({
          ok: true,
          workspacePath
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    };

    for (const sessionId of workspacePathBySession.keys()) {
      const result = await openWorkspaceDirectoryForSession({
        sessionId,
        runtime: createRuntime(),
        fetchImpl,
        mkdirWorkspace: mkdir,
        openPath: async (targetPath) => {
          openedPaths.push(targetPath);
          return "";
        }
      });

      assert.deepEqual(result, {
        opened: true,
        path: workspacePathBySession.get(sessionId)
      });
    }

    assert.deepEqual(requestedSessionIds, ["ses_desktop_ui_one", "ses_desktop_ui_two"]);
    assert.deepEqual(openedPaths, [
      workspacePathBySession.get("ses_desktop_ui_one"),
      workspacePathBySession.get("ses_desktop_ui_two")
    ]);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("openWorkspaceDirectory propagates native open failures with workspace details", async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "monet-open-workspace-tests-"));
  const workspacePath = path.join(fixtureDir, "session-workspace");

  try {
    const result = await openWorkspaceDirectoryForSession({
      sessionId: "ses_native_failure",
      runtime: createRuntime(),
      fetchImpl: workspaceFetch(workspacePath),
      mkdirWorkspace: mkdir,
      openPath: async () => "Finder permission denied"
    });

    assert.deepEqual(result, {
      opened: false,
      path: workspacePath,
      error: "Could not open the workspace folder: Finder permission denied",
      errorDetails: {
        workspacePath,
        nativeOpenFailureReason: "Finder permission denied"
      }
    });
    assert.equal(existsSync(workspacePath), true);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
