import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import { createBuiltinToolDefinitions } from "./builtins";
import { createToolRegistry } from "./registry";

type DnsLookupStub = (hostname: string, options: { all: true; verbatim: true }) => Promise<
  Array<{ address: string; family: number }>
>;

interface ToolCallRow {
  readonly tool_name: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly status: string;
  readonly error_message: string | null;
}

function createTestFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-builtins-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  const storage = createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4o-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4o-mini",
      timeoutMs: null
    }
  });

  const now = new Date().toISOString();
  const connection = new DatabaseSync(databasePath);

  connection.exec("BEGIN");

  try {
    connection
      .prepare(
        `INSERT INTO providers (id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at)
         VALUES ('pro_test_openai', 'openai', 'OpenAI', NULL, 'gpt-4o-mini', 1, NULL, ?, ?)`
      )
      .run(now, now);

    connection
      .prepare(
        `INSERT INTO provider_models (id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at)
         VALUES ('mod_pro_test_openai', 'pro_test_openai', 'gpt-4o-mini', 'gpt-4o-mini', 1, 1, 1, NULL, ?, ?)`
      )
      .run(now, now);

    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    connection.close();
    throw error;
  }

  connection.close();

  return {
    fixtureDir,
    databasePath,
    workspaceDir,
    storage,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

async function createRuntimeTools(
  workspaceDir: string,
  storage: ReturnType<typeof createChatStorage>,
  options?: {
    allowedDirectories?: readonly string[];
    controllerPort?: number;
    dnsLookup?: DnsLookupStub;
    fetchUrlRequest?: (options: {
      url: URL;
      abortSignal: AbortSignal;
      resolvedAddress: { address: string; family: number };
    }) => Promise<{ statusCode: number; statusText: string; headers: Headers; content: string }>;
  }
) {
  const prepared = storage.prepareChatRequest({
    messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "hello" }] }]
  });
  const builtinOptions = {
    allowedDirectories: options?.allowedDirectories ?? [workspaceDir],
    ...(options?.controllerPort !== undefined ? { controllerPort: options.controllerPort } : {}),
    ...(options?.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
    ...(options?.fetchUrlRequest ? { fetchUrlRequest: options.fetchUrlRequest } : {})
  };
  const registry = createToolRegistry(
    createBuiltinToolDefinitions(builtinOptions)
  );

  return (await registry.createRuntimeTools({
    runId: prepared.runId,
    sessionId: prepared.sessionId,
    sessionWorkspacePath: workspaceDir,
    chatStorage: storage,
    logger: createLogger("test")
  })) as Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>;
}

function createExecutionContext() {
  return {
    toolCallId: "call_sdk_1",
    messages: [],
    abortSignal: new AbortController().signal,
    experimental_context: undefined
  };
}

function getToolCalls(databasePath: string) {
  const connection = new DatabaseSync(databasePath);

  try {
    return connection
      .prepare(
        `SELECT tool_name, input_json, output_json, status, error_message
         FROM tool_calls
         ORDER BY started_at ASC`
      )
      .all() as unknown as ToolCallRow[];
  } finally {
    connection.close();
  }
}

test("builtin tool registry exposes fetch/read/write tools", async () => {
  const registry = createToolRegistry(
    createBuiltinToolDefinitions({
      allowedDirectories: [process.cwd()]
    })
  );

  assert.deepEqual(await registry.listTools(), [
    {
      name: "fetch_url",
      description: "Fetches an HTTPS URL and returns the text response body.",
      requiresConfirmation: false
    },
    {
      name: "read_file",
      description: "Reads a UTF-8 text file inside the session workspace or an authorized directory.",
      requiresConfirmation: false
    },
    {
      name: "write_file",
      description: "Writes a UTF-8 text file inside the session workspace or an authorized directory.",
      requiresConfirmation: true
    }
  ]);
});

test("write_file approval is dynamic by path zone", async () => {
  const fixture = createTestFixture();

  try {
    const authorizedDir = join(fixture.fixtureDir, "authorized-external");
    mkdirSync(authorizedDir, { recursive: true });

    const writeFileDefinition = createBuiltinToolDefinitions({
      allowedDirectories: [authorizedDir]
    }).find((definition) => definition.metadata.name === "write_file");

    assert.ok(writeFileDefinition?.needsApproval);
    const writeFileNeedsApproval = writeFileDefinition.needsApproval;

    const approvalContext = {
      toolCallId: "call_sdk_approval",
      messages: [],
      experimental_context: undefined,
      sessionId: "ses_test",
      sessionWorkspacePath: fixture.workspaceDir
    };

    assert.equal(
      await writeFileNeedsApproval(
        { path: "workspace-output.txt", content: "workspace" },
        approvalContext
      ),
      false
    );

    assert.equal(
      await writeFileNeedsApproval(
        { path: join(authorizedDir, "authorized-output.txt"), content: "authorized" },
        approvalContext
      ),
      true
    );

    await assert.rejects(
      async () => writeFileNeedsApproval(
        { path: join(fixture.fixtureDir, "outside-output.txt"), content: "blocked" },
        approvalContext
      ),
      /outside the authorized directories or session workspace/
    );
  } finally {
    fixture.cleanup();
  }
});

test("file tool behavior covers workspace, authorized, denied, and persisted error details", async () => {
  const fixture = createTestFixture();

  try {
    const authorizedDir = join(fixture.fixtureDir, "authorized-external");
    const outsidePath = join(fixture.fixtureDir, "outside-write.txt");
    mkdirSync(authorizedDir, { recursive: true });
    writeFileSync(join(fixture.workspaceDir, "workspace-input.txt"), "workspace read", "utf8");
    writeFileSync(join(authorizedDir, "authorized-input.txt"), "authorized read", "utf8");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: [authorizedDir]
    }) as Record<
      string,
      {
        needsApproval?: (input: unknown, context: unknown) => Promise<boolean> | boolean;
        execute: (input: unknown, context: unknown) => Promise<unknown>;
      }
    >;
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const writeFileNeedsApproval = writeFileTool.needsApproval;
    if (!writeFileNeedsApproval) {
      throw new Error("write_file should expose dynamic approval.");
    }
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);
    const realAuthorizedDir = realpathSync(authorizedDir);
    const approvalContext = {
      toolCallId: "call_sdk_approval",
      messages: [],
      experimental_context: undefined
    };

    assert.equal(
      await writeFileNeedsApproval(
        { path: "workspace-output.txt", content: "workspace write" },
        approvalContext
      ),
      false
    );

    const workspaceWrite = (await writeFileTool.execute(
      { path: "workspace-output.txt", content: "workspace write" },
      { ...createExecutionContext(), toolCallId: "call_workspace_write" }
    )) as { path: string; pathZone: string; requiresConfirmation: boolean; requestedPath: string; resolvedPath: string };
    assert.equal(workspaceWrite.path, join(realWorkspaceDir, "workspace-output.txt"));
    assert.equal(workspaceWrite.pathZone, "session_workspace");
    assert.equal(workspaceWrite.requiresConfirmation, false);
    assert.equal(workspaceWrite.requestedPath, "workspace-output.txt");
    assert.equal(workspaceWrite.resolvedPath, join(realWorkspaceDir, "workspace-output.txt"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "workspace-output.txt"), "utf8"), "workspace write");

    const workspaceRead = (await readFileTool.execute(
      { path: "workspace-input.txt" },
      { ...createExecutionContext(), toolCallId: "call_workspace_read" }
    )) as { content: string; pathZone: string; requiresConfirmation: boolean; resolvedPath: string };
    assert.equal(workspaceRead.content, "workspace read");
    assert.equal(workspaceRead.pathZone, "session_workspace");
    assert.equal(workspaceRead.requiresConfirmation, false);
    assert.equal(workspaceRead.resolvedPath, join(realWorkspaceDir, "workspace-input.txt"));

    const authorizedWritePath = join(authorizedDir, "authorized-output.txt");
    assert.equal(
      await writeFileNeedsApproval(
        { path: authorizedWritePath, content: "authorized write" },
        approvalContext
      ),
      true
    );

    const authorizedWrite = (await writeFileTool.execute(
      { path: authorizedWritePath, content: "authorized write" },
      { ...createExecutionContext(), toolCallId: "call_authorized_write" }
    )) as { path: string; pathZone: string; requiresConfirmation: boolean; requestedPath: string; resolvedPath: string };
    assert.equal(authorizedWrite.path, join(realAuthorizedDir, "authorized-output.txt"));
    assert.equal(authorizedWrite.pathZone, "authorized_directory");
    assert.equal(authorizedWrite.requiresConfirmation, true);
    assert.equal(authorizedWrite.requestedPath, authorizedWritePath);
    assert.equal(authorizedWrite.resolvedPath, join(realAuthorizedDir, "authorized-output.txt"));
    assert.equal(readFileSync(authorizedWritePath, "utf8"), "authorized write");

    const authorizedRead = (await readFileTool.execute(
      { path: join(authorizedDir, "authorized-input.txt") },
      { ...createExecutionContext(), toolCallId: "call_authorized_read" }
    )) as { content: string; pathZone: string; requiresConfirmation: boolean; resolvedPath: string };
    assert.equal(authorizedRead.content, "authorized read");
    assert.equal(authorizedRead.pathZone, "authorized_directory");
    assert.equal(authorizedRead.requiresConfirmation, false);
    assert.equal(authorizedRead.resolvedPath, join(realAuthorizedDir, "authorized-input.txt"));

    await assert.rejects(
      async () => writeFileNeedsApproval(
        { path: outsidePath, content: "blocked" },
        approvalContext
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /outside the authorized directories or session workspace/);
        assert.match(error.message, /Requested path:/);
        assert.match(error.message, /Resolved path:/);
        assert.match(error.message, /outside-write\.txt/);
        return true;
      }
    );

    await assert.rejects(
      writeFileTool.execute(
        { path: outsidePath, content: "blocked" },
        { ...createExecutionContext(), toolCallId: "call_denied_write" }
      ),
      /Requested path:.*outside-write\.txt.*Resolved path:/
    );
    assert.throws(() => readFileSync(outsidePath, "utf8"), /ENOENT/);

    const toolCalls = getToolCalls(fixture.databasePath);
    const deniedWriteCall = toolCalls.find((row) => row.input_json.includes("outside-write.txt"));
    assert.equal(deniedWriteCall?.tool_name, "write_file");
    assert.equal(deniedWriteCall?.status, "failed");
    assert.equal(deniedWriteCall?.output_json, null);
    assert.match(deniedWriteCall?.error_message ?? "", /outside the authorized directories or session workspace/);
    assert.match(deniedWriteCall?.error_message ?? "", /Requested path:.*outside-write\.txt/);
    assert.match(deniedWriteCall?.error_message ?? "", /Resolved path:/);
  } finally {
    fixture.cleanup();
  }
});

test("read_file and write_file operate inside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    writeFileSync(join(fixture.workspaceDir, "input.txt"), "hello from disk", "utf8");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);

    const readResult = (await readFileTool.execute(
      { path: join(fixture.workspaceDir, "input.txt") },
      createExecutionContext()
    )) as { path: string; content: string; sizeBytes: number };

    assert.equal(readResult.content, "hello from disk");
    assert.equal(readResult.path, join(realWorkspaceDir, "input.txt"));
    assert.equal((readResult as Record<string, unknown>).requestedPath, join(fixture.workspaceDir, "input.txt"));
    assert.equal((readResult as Record<string, unknown>).resolvedPath, join(realWorkspaceDir, "input.txt"));
    assert.equal((readResult as Record<string, unknown>).pathZone, "session_workspace");
    assert.equal((readResult as Record<string, unknown>).requiresConfirmation, false);
    assert.equal(readResult.sizeBytes, Buffer.byteLength("hello from disk", "utf8"));

    const writeResult = (await writeFileTool.execute(
      {
        path: join(fixture.workspaceDir, "nested", "output.txt"),
        content: "generated content"
      },
      createExecutionContext()
    )) as { path: string; bytesWritten: number };

    assert.equal(writeResult.path, join(realWorkspaceDir, "nested", "output.txt"));
    assert.equal((writeResult as Record<string, unknown>).requestedPath, join(fixture.workspaceDir, "nested", "output.txt"));
    assert.equal((writeResult as Record<string, unknown>).resolvedPath, join(realWorkspaceDir, "nested", "output.txt"));
    assert.equal((writeResult as Record<string, unknown>).pathZone, "session_workspace");
    assert.equal((writeResult as Record<string, unknown>).requiresConfirmation, false);
    assert.equal(writeResult.bytesWritten, Buffer.byteLength("generated content", "utf8"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "nested", "output.txt"), "utf8"), "generated content");

    const readRelativeResult = (await readFileTool.execute(
      { path: "input.txt" },
      createExecutionContext()
    )) as { path: string; content: string };

    assert.equal(readRelativeResult.content, "hello from disk");
    assert.equal(readRelativeResult.path, join(realWorkspaceDir, "input.txt"));
    assert.equal((readRelativeResult as Record<string, unknown>).requestedPath, "input.txt");
    assert.equal((readRelativeResult as Record<string, unknown>).resolvedPath, join(realWorkspaceDir, "input.txt"));
    assert.equal((readRelativeResult as Record<string, unknown>).pathZone, "session_workspace");
    assert.equal((readRelativeResult as Record<string, unknown>).requiresConfirmation, false);

    const writeRelativeResult = (await writeFileTool.execute(
      {
        path: "nested/relative-output.txt",
        content: "relative generated content"
      },
      createExecutionContext()
    )) as { path: string; bytesWritten: number };

    assert.equal(writeRelativeResult.path, join(realWorkspaceDir, "nested", "relative-output.txt"));
    assert.equal((writeRelativeResult as Record<string, unknown>).requestedPath, "nested/relative-output.txt");
    assert.equal((writeRelativeResult as Record<string, unknown>).resolvedPath, join(realWorkspaceDir, "nested", "relative-output.txt"));
    assert.equal((writeRelativeResult as Record<string, unknown>).pathZone, "session_workspace");
    assert.equal((writeRelativeResult as Record<string, unknown>).requiresConfirmation, false);
    assert.equal(writeRelativeResult.bytesWritten, Buffer.byteLength("relative generated content", "utf8"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "nested", "relative-output.txt"), "utf8"), "relative generated content");
  } finally {
    fixture.cleanup();
  }
});

test("relative file paths resolve against the session workspace, not cwd or authorized directories", async () => {
  const fixture = createTestFixture();
  const originalCwd = process.cwd();

  try {
    const controllerCwdDir = join(fixture.fixtureDir, "controller-cwd");
    const authorizedDir = join(fixture.fixtureDir, "authorized-external");
    mkdirSync(controllerCwdDir, { recursive: true });
    mkdirSync(authorizedDir, { recursive: true });
    writeFileSync(join(fixture.workspaceDir, "same-name.txt"), "from session workspace", "utf8");
    writeFileSync(join(controllerCwdDir, "same-name.txt"), "from cwd", "utf8");
    writeFileSync(join(authorizedDir, "same-name.txt"), "from authorized directory", "utf8");

    process.chdir(controllerCwdDir);

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: [authorizedDir]
    });
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);

    const readResult = (await readFileTool.execute(
      { path: "same-name.txt" },
      createExecutionContext()
    )) as { path: string; content: string };

    assert.equal(readResult.content, "from session workspace");
    assert.equal(readResult.path, join(realWorkspaceDir, "same-name.txt"));

    const writeResult = (await writeFileTool.execute(
      {
        path: "created-by-relative-write.txt",
        content: "written to workspace"
      },
      createExecutionContext()
    )) as { path: string; bytesWritten: number };

    assert.equal(writeResult.path, join(realWorkspaceDir, "created-by-relative-write.txt"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "created-by-relative-write.txt"), "utf8"), "written to workspace");
    assert.throws(() => readFileSync(join(controllerCwdDir, "created-by-relative-write.txt"), "utf8"), /ENOENT/);
    assert.throws(() => readFileSync(join(authorizedDir, "created-by-relative-write.txt"), "utf8"), /ENOENT/);
  } finally {
    process.chdir(originalCwd);
    fixture.cleanup();
  }
});

test("relative file paths still use the session workspace with an empty authorized directory list", async () => {
  const fixture = createTestFixture();
  const originalCwd = process.cwd();

  try {
    const controllerCwdDir = join(fixture.fixtureDir, "controller-cwd-empty-allowlist");
    mkdirSync(controllerCwdDir, { recursive: true });
    writeFileSync(join(fixture.workspaceDir, "same-name.txt"), "from session workspace", "utf8");
    writeFileSync(join(controllerCwdDir, "same-name.txt"), "from cwd", "utf8");

    process.chdir(controllerCwdDir);

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: []
    });
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);

    const readResult = (await readFileTool.execute(
      { path: "same-name.txt" },
      createExecutionContext()
    )) as { path: string; content: string; pathZone: string; requiresConfirmation: boolean };

    assert.equal(readResult.content, "from session workspace");
    assert.equal(readResult.path, join(realWorkspaceDir, "same-name.txt"));
    assert.equal(readResult.pathZone, "session_workspace");
    assert.equal(readResult.requiresConfirmation, false);

    const writeResult = (await writeFileTool.execute(
      {
        path: "created-with-empty-allowlist.txt",
        content: "written to workspace"
      },
      createExecutionContext()
    )) as { path: string; pathZone: string; requiresConfirmation: boolean };

    assert.equal(writeResult.path, join(realWorkspaceDir, "created-with-empty-allowlist.txt"));
    assert.equal(writeResult.pathZone, "session_workspace");
    assert.equal(writeResult.requiresConfirmation, false);
    assert.equal(readFileSync(join(fixture.workspaceDir, "created-with-empty-allowlist.txt"), "utf8"), "written to workspace");
    assert.throws(() => readFileSync(join(controllerCwdDir, "created-with-empty-allowlist.txt"), "utf8"), /ENOENT/);
  } finally {
    process.chdir(originalCwd);
    fixture.cleanup();
  }
});

test("file tools isolate session workspaces by default across relative and absolute paths", async () => {
  const fixture = createTestFixture();

  try {
    const sessionAWorkspaceDir = join(fixture.fixtureDir, "session-a-workspace");
    const sessionBWorkspaceDir = join(fixture.fixtureDir, "session-b-workspace");
    mkdirSync(sessionAWorkspaceDir, { recursive: true });
    mkdirSync(sessionBWorkspaceDir, { recursive: true });
    mkdirSync(join(sessionAWorkspaceDir, "session-b-workspace"), { recursive: true });
    writeFileSync(join(sessionAWorkspaceDir, "shared.txt"), "from session A", "utf8");
    writeFileSync(join(sessionAWorkspaceDir, "session-b-workspace", "secret.txt"), "nested inside session A", "utf8");
    writeFileSync(join(sessionBWorkspaceDir, "shared.txt"), "from session B", "utf8");
    writeFileSync(join(sessionBWorkspaceDir, "secret.txt"), "session B secret", "utf8");

    const sessionARuntimeTools = await createRuntimeTools(sessionAWorkspaceDir, fixture.storage, {
      allowedDirectories: []
    });
    const readFileTool = sessionARuntimeTools.read_file!;
    const writeFileTool = sessionARuntimeTools.write_file!;
    const realSessionAWorkspaceDir = realpathSync(sessionAWorkspaceDir);

    const relativeSameNameRead = (await readFileTool.execute(
      { path: "shared.txt" },
      createExecutionContext()
    )) as { content: string; resolvedPath: string; pathZone: string };
    assert.equal(relativeSameNameRead.content, "from session A");
    assert.equal(relativeSameNameRead.resolvedPath, join(realSessionAWorkspaceDir, "shared.txt"));
    assert.equal(relativeSameNameRead.pathZone, "session_workspace");

    const siblingNamedRelativeRead = (await readFileTool.execute(
      { path: "session-b-workspace/secret.txt" },
      createExecutionContext()
    )) as { content: string; resolvedPath: string; pathZone: string };
    assert.equal(siblingNamedRelativeRead.content, "nested inside session A");
    assert.equal(siblingNamedRelativeRead.resolvedPath, join(realSessionAWorkspaceDir, "session-b-workspace", "secret.txt"));
    assert.equal(siblingNamedRelativeRead.pathZone, "session_workspace");

    await assert.rejects(
      readFileTool.execute(
        { path: join(sessionBWorkspaceDir, "secret.txt") },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    await assert.rejects(
      readFileTool.execute(
        { path: join("..", "session-b-workspace", "secret.txt") },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    await assert.rejects(
      writeFileTool.execute(
        {
          path: join(sessionBWorkspaceDir, "secret.txt"),
          content: "session A overwrite attempt"
        },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    await assert.rejects(
      writeFileTool.execute(
        {
          path: join("..", "session-b-workspace", "created-by-a.txt"),
          content: "session A escape attempt"
        },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    assert.equal(readFileSync(join(sessionBWorkspaceDir, "secret.txt"), "utf8"), "session B secret");
    assert.throws(() => readFileSync(join(sessionBWorkspaceDir, "created-by-a.txt"), "utf8"), /ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

test("file tools access another session workspace only when explicitly authorized and require write confirmation", async () => {
  const fixture = createTestFixture();

  try {
    const sessionAWorkspaceDir = join(fixture.fixtureDir, "session-a-workspace");
    const sessionBWorkspaceDir = join(fixture.fixtureDir, "session-b-workspace");
    mkdirSync(sessionAWorkspaceDir, { recursive: true });
    mkdirSync(sessionBWorkspaceDir, { recursive: true });
    writeFileSync(join(sessionBWorkspaceDir, "shared.txt"), "from session B", "utf8");

    const blockedSessionATools = await createRuntimeTools(sessionAWorkspaceDir, fixture.storage, {
      allowedDirectories: []
    });
    await assert.rejects(
      blockedSessionATools.read_file!.execute(
        { path: join(sessionBWorkspaceDir, "shared.txt") },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );
    await assert.rejects(
      blockedSessionATools.write_file!.execute(
        {
          path: join(sessionBWorkspaceDir, "created-by-a.txt"),
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    const authorizedSessionATools = await createRuntimeTools(sessionAWorkspaceDir, fixture.storage, {
      allowedDirectories: [sessionBWorkspaceDir]
    });
    const realSessionBWorkspaceDir = realpathSync(sessionBWorkspaceDir);

    const authorizedRead = (await authorizedSessionATools.read_file!.execute(
      { path: join(sessionBWorkspaceDir, "shared.txt") },
      createExecutionContext()
    )) as { content: string; requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(authorizedRead.content, "from session B");
    assert.equal(authorizedRead.requestedPath, join(sessionBWorkspaceDir, "shared.txt"));
    assert.equal(authorizedRead.resolvedPath, join(realSessionBWorkspaceDir, "shared.txt"));
    assert.equal(authorizedRead.pathZone, "authorized_directory");
    assert.equal(authorizedRead.requiresConfirmation, false);

    const authorizedWrite = (await authorizedSessionATools.write_file!.execute(
      {
        path: join(sessionBWorkspaceDir, "created-by-a.txt"),
        content: "created by session A with authorization"
      },
      createExecutionContext()
    )) as { requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(authorizedWrite.requestedPath, join(sessionBWorkspaceDir, "created-by-a.txt"));
    assert.equal(authorizedWrite.resolvedPath, join(realSessionBWorkspaceDir, "created-by-a.txt"));
    assert.equal(authorizedWrite.pathZone, "authorized_directory");
    assert.equal(authorizedWrite.requiresConfirmation, true);
    assert.equal(
      readFileSync(join(sessionBWorkspaceDir, "created-by-a.txt"), "utf8"),
      "created by session A with authorization"
    );

    const writeFileDefinition = createBuiltinToolDefinitions({
      allowedDirectories: [sessionBWorkspaceDir]
    }).find((definition) => definition.metadata.name === "write_file");
    assert.ok(writeFileDefinition?.needsApproval);
    assert.equal(
      await writeFileDefinition.needsApproval(
        {
          path: join(sessionBWorkspaceDir, "approval-required.txt"),
          content: "approval required"
        },
        {
          toolCallId: "call_sdk_cross_session_approval",
          messages: [],
          experimental_context: undefined,
          sessionId: "session-a",
          sessionWorkspacePath: sessionAWorkspaceDir
        }
      ),
      true
    );
  } finally {
    fixture.cleanup();
  }
});

test("authorized external directory writes require confirmation and outside-both writes are denied", async () => {
  const fixture = createTestFixture();

  try {
    const authorizedExternalDir = join(fixture.fixtureDir, "authorized-external");
    const outsideDir = join(fixture.fixtureDir, "outside-external");
    mkdirSync(authorizedExternalDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    const authorizedWritePath = join(authorizedExternalDir, "authorized-write.txt");
    const outsideWritePath = join(outsideDir, "denied-write.txt");
    const writeFileDefinition = createBuiltinToolDefinitions({
      allowedDirectories: [authorizedExternalDir]
    }).find((definition) => definition.metadata.name === "write_file");
    assert.ok(writeFileDefinition?.needsApproval);

    const approvalContext = {
      toolCallId: "call_external_approval",
      messages: [],
      experimental_context: undefined,
      sessionId: "ses_external_write",
      sessionWorkspacePath: fixture.workspaceDir
    };

    assert.equal(
      await writeFileDefinition.needsApproval(
        { path: authorizedWritePath, content: "requires confirmation" },
        approvalContext
      ),
      true
    );

    await assert.rejects(
      async () => writeFileDefinition.needsApproval?.(
        { path: outsideWritePath, content: "denied" },
        approvalContext
      ),
      /outside the authorized directories or session workspace/
    );

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: [authorizedExternalDir]
    });
    const writeFileTool = runtimeTools.write_file!;
    const realAuthorizedExternalDir = realpathSync(authorizedExternalDir);

    const authorizedWrite = (await writeFileTool.execute(
      { path: authorizedWritePath, content: "authorized external write" },
      { ...createExecutionContext(), toolCallId: "call_authorized_external_write" }
    )) as { requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(authorizedWrite.requestedPath, authorizedWritePath);
    assert.equal(authorizedWrite.resolvedPath, join(realAuthorizedExternalDir, "authorized-write.txt"));
    assert.equal(authorizedWrite.pathZone, "authorized_directory");
    assert.equal(authorizedWrite.requiresConfirmation, true);
    assert.equal(readFileSync(authorizedWritePath, "utf8"), "authorized external write");

    await assert.rejects(
      writeFileTool.execute(
        { path: outsideWritePath, content: "denied external write" },
        { ...createExecutionContext(), toolCallId: "call_denied_external_write" }
      ),
      /outside the authorized directories or session workspace/
    );
    assert.throws(() => readFileSync(outsideWritePath, "utf8"), /ENOENT/);

    const toolCalls = getToolCalls(fixture.databasePath);
    const authorizedCall = toolCalls.find((row) => row.input_json.includes("authorized-write.txt"));
    assert.equal(authorizedCall?.tool_name, "write_file");
    assert.equal(authorizedCall?.status, "completed");
    assert.match(authorizedCall?.output_json ?? "", /"pathZone":"authorized_directory"/);
    assert.match(authorizedCall?.output_json ?? "", /"requiresConfirmation":true/);

    const deniedCall = toolCalls.find((row) => row.input_json.includes("denied-write.txt"));
    assert.equal(deniedCall?.tool_name, "write_file");
    assert.equal(deniedCall?.status, "failed");
    assert.match(deniedCall?.error_message ?? "", /outside the authorized directories or session workspace/);
  } finally {
    fixture.cleanup();
  }
});

test("read_file and write_file reject relative path traversal escapes", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const outsidePath = join(fixture.workspaceDir, "..", "outside-attempt.txt");
    writeFileSync(join(fixture.fixtureDir, "outside-attempt.txt"), "should not read", "utf8");

    await assert.rejects(
      readFileTool.execute(
        {
          path: "../outside-attempt.txt"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    await assert.rejects(
      writeFileTool.execute(
        {
          path: "../outside-attempt.txt",
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    assert.equal(readFileSync(outsidePath, "utf8"), "should not read");
  } finally {
    fixture.cleanup();
  }
});

test("read_file and write_file reject absolute traversal escapes from the workspace", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const outsidePath = join(fixture.workspaceDir, "..", "absolute-outside-attempt.txt");
    writeFileSync(outsidePath, "should remain unchanged", "utf8");

    await assert.rejects(
      readFileTool.execute(
        {
          path: outsidePath
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    await assert.rejects(
      writeFileTool.execute(
        {
          path: outsidePath,
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    assert.equal(readFileSync(outsidePath, "utf8"), "should remain unchanged");
  } finally {
    fixture.cleanup();
  }
});

test("read_file rejects paths outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;
    const outsidePath = join(fixture.fixtureDir, "outside.txt");

    writeFileSync(outsidePath, "blocked", "utf8");

    await assert.rejects(
      readFileTool.execute(
        {
          path: outsidePath
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );
  } finally {
    fixture.cleanup();
  }
});

test("write_file rejects denied absolute paths outside workspace and authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: []
    });
    const writeFileTool = runtimeTools.write_file!;
    const outsidePath = join(fixture.fixtureDir, "outside-write.txt");

    await assert.rejects(
      writeFileTool.execute(
        {
          path: outsidePath,
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    assert.throws(() => readFileSync(outsidePath, "utf8"), /ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

test("file tools classify authorized directory paths separately from session workspace paths", async () => {
  const fixture = createTestFixture();

  try {
    const authorizedDir = join(fixture.fixtureDir, "authorized-external");
    mkdirSync(authorizedDir, { recursive: true });
    writeFileSync(join(authorizedDir, "authorized-input.txt"), "from authorized", "utf8");
    writeFileSync(join(fixture.workspaceDir, "workspace-input.txt"), "from workspace", "utf8");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      allowedDirectories: [authorizedDir]
    });
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);
    const realAuthorizedDir = realpathSync(authorizedDir);

    const relativeWorkspaceRead = (await readFileTool.execute(
      { path: "workspace-input.txt" },
      createExecutionContext()
    )) as { path: string; requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(relativeWorkspaceRead.path, join(realWorkspaceDir, "workspace-input.txt"));
    assert.equal(relativeWorkspaceRead.requestedPath, "workspace-input.txt");
    assert.equal(relativeWorkspaceRead.resolvedPath, join(realWorkspaceDir, "workspace-input.txt"));
    assert.equal(relativeWorkspaceRead.pathZone, "session_workspace");
    assert.equal(relativeWorkspaceRead.requiresConfirmation, false);

    const authorizedRead = (await readFileTool.execute(
      { path: join(authorizedDir, "authorized-input.txt") },
      createExecutionContext()
    )) as { path: string; requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(authorizedRead.path, join(realAuthorizedDir, "authorized-input.txt"));
    assert.equal(authorizedRead.requestedPath, join(authorizedDir, "authorized-input.txt"));
    assert.equal(authorizedRead.resolvedPath, join(realAuthorizedDir, "authorized-input.txt"));
    assert.equal(authorizedRead.pathZone, "authorized_directory");
    assert.equal(authorizedRead.requiresConfirmation, false);

    const authorizedWrite = (await writeFileTool.execute(
      {
        path: join(authorizedDir, "authorized-output.txt"),
        content: "to authorized"
      },
      createExecutionContext()
    )) as { path: string; requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(authorizedWrite.path, join(realAuthorizedDir, "authorized-output.txt"));
    assert.equal(authorizedWrite.requestedPath, join(authorizedDir, "authorized-output.txt"));
    assert.equal(authorizedWrite.resolvedPath, join(realAuthorizedDir, "authorized-output.txt"));
    assert.equal(authorizedWrite.pathZone, "authorized_directory");
    assert.equal(authorizedWrite.requiresConfirmation, true);
    assert.equal(readFileSync(join(authorizedDir, "authorized-output.txt"), "utf8"), "to authorized");
  } finally {
    fixture.cleanup();
  }
});

test("runtime tools pick up authorized directory updates after creation", async () => {
  const fixture = createTestFixture();

  try {
    const firstWorkspaceDir = join(fixture.fixtureDir, "workspace-a");
    const secondWorkspaceDir = join(fixture.fixtureDir, "workspace-b");
    mkdirSync(firstWorkspaceDir, { recursive: true });
    mkdirSync(secondWorkspaceDir, { recursive: true });
    writeFileSync(join(firstWorkspaceDir, "first.txt"), "first", "utf8");
    writeFileSync(join(secondWorkspaceDir, "second.txt"), "second", "utf8");

    let allowedDirectories = [firstWorkspaceDir];
    const prepared = fixture.storage.prepareChatRequest({
      messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "hello" }] }]
    });
    const registry = createToolRegistry(
      createBuiltinToolDefinitions({
        allowedDirectories,
        getAllowedDirectories: () => allowedDirectories
      })
    );
    const runtimeTools = await registry.createRuntimeTools({
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      sessionWorkspacePath: fixture.workspaceDir,
      chatStorage: fixture.storage,
      logger: createLogger("test")
    }) as Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>;
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;

    const firstResult = (await readFileTool.execute(
      { path: join(firstWorkspaceDir, "first.txt") },
      createExecutionContext()
    )) as { content: string; requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(firstResult.content, "first");
    assert.equal(firstResult.requestedPath, join(firstWorkspaceDir, "first.txt"));
    assert.equal(firstResult.resolvedPath, join(realpathSync(firstWorkspaceDir), "first.txt"));
    assert.equal(firstResult.pathZone, "authorized_directory");
    assert.equal(firstResult.requiresConfirmation, false);

    const firstWriteResult = (await writeFileTool.execute(
      {
        path: join(firstWorkspaceDir, "first-write.txt"),
        content: "first write"
      },
      createExecutionContext()
    )) as { requestedPath: string; resolvedPath: string; pathZone: string; requiresConfirmation: boolean };
    assert.equal(firstWriteResult.requestedPath, join(firstWorkspaceDir, "first-write.txt"));
    assert.equal(firstWriteResult.resolvedPath, join(realpathSync(firstWorkspaceDir), "first-write.txt"));
    assert.equal(firstWriteResult.pathZone, "authorized_directory");
    assert.equal(firstWriteResult.requiresConfirmation, true);
    assert.equal(readFileSync(join(firstWorkspaceDir, "first-write.txt"), "utf8"), "first write");

    allowedDirectories = [secondWorkspaceDir];

    await assert.rejects(
      readFileTool.execute(
        {
          path: join(firstWorkspaceDir, "first.txt")
        },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    await assert.rejects(
      writeFileTool.execute(
        {
          path: join(firstWorkspaceDir, "blocked-write.txt"),
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories|No authorized directories are currently available/
    );

    const secondResult = (await readFileTool.execute(
      { path: join(secondWorkspaceDir, "second.txt") },
      createExecutionContext()
    )) as { content: string };
    assert.equal(secondResult.content, "second");

    await writeFileTool.execute(
      {
        path: join(secondWorkspaceDir, "second-write.txt"),
        content: "second write"
      },
      createExecutionContext()
    );
    assert.equal(readFileSync(join(secondWorkspaceDir, "second-write.txt"), "utf8"), "second write");
  } finally {
    fixture.cleanup();
  }
});

test("read_file rejects symlink escapes outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const outsideDir = join(fixture.fixtureDir, "outside");
    const symlinkPath = join(fixture.workspaceDir, "linked-outside");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.txt"), "top secret", "utf8");
    symlinkSync(outsideDir, symlinkPath, "dir");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;

    await assert.rejects(
      readFileTool.execute(
        {
          path: join(symlinkPath, "secret.txt")
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );
  } finally {
    fixture.cleanup();
  }
});

test("read_file rejects oversized files before reading them into memory", async () => {
  const fixture = createTestFixture();

  try {
    const oversizedPath = join(fixture.workspaceDir, "oversized.txt");
    writeFileSync(oversizedPath, "x".repeat(1_000_001), "utf8");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;

    await assert.rejects(
      readFileTool.execute(
        {
          path: oversizedPath
        },
        createExecutionContext()
      ),
      /read_file exceeded the size limit of 1000000 bytes/
    );
  } finally {
    fixture.cleanup();
  }
});

test("write_file rejects oversized content before creating a partial file", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const writeFileTool = runtimeTools.write_file!;
    const oversizedTargetPath = join(fixture.workspaceDir, "oversized-write.txt");

    await assert.rejects(
      writeFileTool.execute(
        {
          path: oversizedTargetPath,
          content: "x".repeat(1_000_001)
        },
        createExecutionContext()
      ),
      /write_file content exceeded the size limit of 1000000 bytes/
    );

    assert.throws(() => readFileSync(oversizedTargetPath, "utf8"), /ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

test("write_file rejects workspace quota overflow before creating a partial file", async () => {
  const fixture = createTestFixture();

  try {
    const fillerPath = join(fixture.workspaceDir, "quota-filler.bin");
    const oversizedTargetPath = join(fixture.workspaceDir, "quota-overflow.txt");
    writeFileSync(fillerPath, "", "utf8");
    truncateSync(fillerPath, 100 * 1024 * 1024 - 10);

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const writeFileTool = runtimeTools.write_file!;

    await assert.rejects(
      writeFileTool.execute(
        {
          path: oversizedTargetPath,
          content: "exceeds quota"
        },
        createExecutionContext()
      ),
      /Session workspace quota exceeded/
    );

    assert.throws(() => readFileSync(oversizedTargetPath, "utf8"), /ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

test("write_file rejects workspace quota overflow without partially overwriting an existing file", async () => {
  const fixture = createTestFixture();

  try {
    const fillerPath = join(fixture.workspaceDir, "quota-filler.bin");
    const existingTargetPath = join(fixture.workspaceDir, "existing.txt");
    writeFileSync(existingTargetPath, "safe", "utf8");
    writeFileSync(fillerPath, "", "utf8");
    truncateSync(fillerPath, 100 * 1024 * 1024 - Buffer.byteLength("safe", "utf8"));

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const writeFileTool = runtimeTools.write_file!;

    await assert.rejects(
      writeFileTool.execute(
        {
          path: existingTargetPath,
          content: "would exceed quota"
        },
        createExecutionContext()
      ),
      /Session workspace quota exceeded/
    );

    assert.equal(readFileSync(existingTargetPath, "utf8"), "safe");
  } finally {
    fixture.cleanup();
  }
});

test("write_file rejects symlink escapes outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const outsideDir = join(fixture.fixtureDir, "outside");
    const symlinkPath = join(fixture.workspaceDir, "linked-outside");
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, symlinkPath, "dir");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const writeFileTool = runtimeTools.write_file!;

    await assert.rejects(
      writeFileTool.execute(
        {
          path: join(symlinkPath, "written.txt"),
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );
  } finally {
    fixture.cleanup();
  }
});

test("file tools canonicalize symlinked workspace and authorized directory roots", async () => {
  const fixture = createTestFixture();

  try {
    const workspaceLink = join(fixture.fixtureDir, "workspace-link");
    const authorizedDir = join(fixture.fixtureDir, "authorized");
    const authorizedLink = join(fixture.fixtureDir, "authorized-link");
    mkdirSync(authorizedDir, { recursive: true });
    symlinkSync(fixture.workspaceDir, workspaceLink, "dir");
    symlinkSync(authorizedDir, authorizedLink, "dir");
    writeFileSync(join(fixture.workspaceDir, "workspace-input.txt"), "from workspace", "utf8");
    writeFileSync(join(authorizedDir, "authorized-input.txt"), "from authorized", "utf8");

    const runtimeTools = await createRuntimeTools(workspaceLink, fixture.storage, {
      allowedDirectories: [authorizedLink]
    });
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);
    const realAuthorizedDir = realpathSync(authorizedDir);

    const workspaceReadResult = (await readFileTool.execute(
      { path: "workspace-input.txt" },
      createExecutionContext()
    )) as { path: string; content: string };
    assert.equal(workspaceReadResult.content, "from workspace");
    assert.equal(workspaceReadResult.path, join(realWorkspaceDir, "workspace-input.txt"));

    const authorizedReadResult = (await readFileTool.execute(
      { path: join(authorizedLink, "authorized-input.txt") },
      createExecutionContext()
    )) as { path: string; content: string };
    assert.equal(authorizedReadResult.content, "from authorized");
    assert.equal(authorizedReadResult.path, join(realAuthorizedDir, "authorized-input.txt"));

    const writeResult = (await writeFileTool.execute(
      {
        path: "nested/generated.txt",
        content: "from symlinked workspace"
      },
      createExecutionContext()
    )) as { path: string; bytesWritten: number };
    assert.equal(writeResult.path, join(realWorkspaceDir, "nested", "generated.txt"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "nested", "generated.txt"), "utf8"), "from symlinked workspace");
  } finally {
    fixture.cleanup();
  }
});

test("write_file canonicalizes non-existing targets through nearest existing parent", async () => {
  const fixture = createTestFixture();

  try {
    const outsideDir = join(fixture.fixtureDir, "outside");
    const symlinkPath = join(fixture.workspaceDir, "linked-outside");
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, symlinkPath, "dir");

    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const writeFileTool = runtimeTools.write_file!;

    await assert.rejects(
      writeFileTool.execute(
        {
          path: "linked-outside/new/deep/file.txt",
          content: "blocked"
        },
        createExecutionContext()
      ),
      /outside the authorized directories/
    );

    assert.throws(() => readFileSync(join(outsideDir, "new", "deep", "file.txt"), "utf8"), /ENOENT/);
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url fetches HTTPS text responses", async () => {
  const fixture = createTestFixture();
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup,
      async fetchUrlRequest({ url, resolvedAddress }) {
        assert.equal(url.toString(), "https://example.com/article");
        assert.deepEqual(resolvedAddress, { address: "93.184.216.34", family: 4 });

        return {
          statusCode: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "text/plain; charset=utf-8"
          }),
          content: "hello from the network"
        };
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;
    const result = (await fetchUrlTool.execute(
      {
        url: "https://example.com/article"
      },
      createExecutionContext()
    )) as {
      url: string;
      statusCode: number;
      statusText: string;
      contentType: string | null;
      content: string;
    };

    assert.equal(result.statusCode, 200);
    assert.equal(result.contentType, "text/plain; charset=utf-8");
    assert.equal(result.content, "hello from the network");
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url truncates large returned content before sending it to the model", async () => {
  const fixture = createTestFixture();
  const largeContent = "a".repeat(80 * 1024);

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      async fetchUrlRequest() {
        return {
          statusCode: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "text/plain; charset=utf-8"
          }),
          content: largeContent
        };
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;
    const result = (await fetchUrlTool.execute(
      {
        url: "https://example.com/large"
      },
      createExecutionContext()
    )) as {
      content: string;
      contentTruncated: boolean;
      contentSizeBytes: number;
    };

    assert.equal(result.contentTruncated, true);
    assert.equal(result.contentSizeBytes, Buffer.byteLength(largeContent, "utf8"));
    assert.ok(Buffer.byteLength(result.content, "utf8") <= 64 * 1024);
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects non-HTTPS URLs", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "http://example.com/article"
        },
        createExecutionContext()
      ),
      /only supports HTTPS/
    );
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects loopback and private network destinations", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://127.0.0.1/private"
        },
        createExecutionContext()
      ),
      /blocks loopback, private, link-local, and metadata/
    );

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://192.168.1.10/private"
        },
        createExecutionContext()
      ),
      /blocks loopback, private, link-local, and metadata/
    );
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects resolved private destinations before fetching", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      async fetchUrlRequest() {
        throw new Error("request should not be called");
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://internal.example.com/private"
        },
        createExecutionContext()
      ),
      /blocks loopback, private, link-local, and metadata/
    );
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url binds requests to the vetted DNS result", async () => {
  const fixture = createTestFixture();
  let lookupCount = 0;

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup: async () => {
        lookupCount += 1;

        return lookupCount === 1
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      },
      async fetchUrlRequest({ url, resolvedAddress }) {
        assert.equal(url.toString(), "https://example.com/article");
        assert.deepEqual(resolvedAddress, { address: "93.184.216.34", family: 4 });

        return {
          statusCode: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "text/plain"
          }),
          content: "rebind blocked"
        };
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;
    const result = (await fetchUrlTool.execute(
      {
        url: "https://example.com/article"
      },
      createExecutionContext()
    )) as { content: string };

    assert.equal(result.content, "rebind blocked");
    assert.equal(lookupCount, 1);
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects access to the local controller port", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      controllerPort: 42831
    });
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://127.0.0.1:42831/health"
        },
        createExecutionContext()
      ),
      /cannot access the local controller port/
    );
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url follows bounded redirects", async () => {
  const fixture = createTestFixture();
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    const seenUrls: string[] = [];
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup,
      async fetchUrlRequest({ url }) {
        const requestUrl = url.toString();
        seenUrls.push(requestUrl);

        if (requestUrl === "https://example.com/start") {
          return {
            statusCode: 302,
            statusText: "Found",
            headers: new Headers({
              location: "/next"
            }),
            content: ""
          };
        }

        return {
          statusCode: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "text/plain"
          }),
          content: "redirect complete"
        };
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;
    const result = (await fetchUrlTool.execute(
      {
        url: "https://example.com/start"
      },
      createExecutionContext()
    )) as { url: string; content: string };

    assert.deepEqual(seenUrls, ["https://example.com/start", "https://example.com/next"]);
    assert.equal(result.url, "https://example.com/next");
    assert.equal(result.content, "redirect complete");
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects redirect chains beyond the limit", async () => {
  const fixture = createTestFixture();
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    const runtimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup,
      async fetchUrlRequest({ url }) {
        const step = Number.parseInt(url.pathname.replace("/", ""), 10);

        return {
          statusCode: 302,
          statusText: "Found",
          headers: new Headers({
            location: `https://example.com/${step + 1}`
          }),
          content: ""
        };
      }
    });
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://example.com/1"
        },
        createExecutionContext()
      ),
      /exceeded the redirect limit/
    );
  } finally {
    fixture.cleanup();
  }
});

test("fetch_url rejects oversized responses", async () => {
  const fixture = createTestFixture();
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    const oversizedRuntimeTools = await createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup,
      async fetchUrlRequest() {
        return {
          statusCode: 200,
          statusText: "OK",
          headers: new Headers({
            "content-type": "text/plain",
            "content-length": "1000001"
          }),
          content: "too big"
        };
      }
    });
    const oversizedFetchUrlTool = oversizedRuntimeTools.fetch_url!;

    await assert.rejects(
      oversizedFetchUrlTool.execute(
        {
          url: "https://example.com/large"
        },
        createExecutionContext()
      ),
      /response exceeded the size limit/
    );
  } finally {
    fixture.cleanup();
  }
});
