import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createChatStorage } from "../chat-storage";
import { createLogger } from "../logger";
import { createBuiltinToolDefinitions } from "./builtins";
import { createToolRegistry } from "./registry";

type DnsLookupStub = (hostname: string, options: { all: true; verbatim: true }) => Promise<
  Array<{ address: string; family: number }>
>;

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
    }
  });

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

function createRuntimeTools(
  workspaceDir: string,
  storage: ReturnType<typeof createChatStorage>,
  options?: { controllerPort?: number; dnsLookup?: DnsLookupStub }
) {
  const prepared = storage.prepareChatRequest({
    messages: [{ id: "msg_user", role: "user", parts: [{ type: "text", text: "hello" }] }]
  });
  const builtinOptions = {
    allowedDirectories: [workspaceDir],
    ...(options?.controllerPort !== undefined ? { controllerPort: options.controllerPort } : {}),
    ...(options?.dnsLookup ? { dnsLookup: options.dnsLookup } : {})
  };
  const registry = createToolRegistry(
    createBuiltinToolDefinitions(builtinOptions)
  );

  return registry.createRuntimeTools({
    runId: prepared.runId,
    chatStorage: storage,
    logger: createLogger("test")
  }) as Record<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>;
}

function createExecutionContext() {
  return {
    toolCallId: "call_sdk_1",
    messages: [],
    abortSignal: new AbortController().signal,
    experimental_context: undefined
  };
}

test("builtin tool registry exposes fetch/read/write tools", () => {
  const registry = createToolRegistry(
    createBuiltinToolDefinitions({
      allowedDirectories: [process.cwd()]
    })
  );

  assert.deepEqual(registry.listTools(), [
    {
      name: "fetch_url",
      description: "Fetches an HTTPS URL and returns the text response body.",
      requiresConfirmation: false
    },
    {
      name: "read_file",
      description: "Reads a UTF-8 text file from an authorized directory.",
      requiresConfirmation: false
    },
    {
      name: "write_file",
      description: "Writes a UTF-8 text file inside an authorized directory.",
      requiresConfirmation: true
    }
  ]);
});

test("read_file and write_file operate inside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    writeFileSync(join(fixture.workspaceDir, "input.txt"), "hello from disk", "utf8");

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
    const readFileTool = runtimeTools.read_file!;
    const writeFileTool = runtimeTools.write_file!;
    const realWorkspaceDir = realpathSync(fixture.workspaceDir);

    const readResult = (await readFileTool.execute(
      { path: join(fixture.workspaceDir, "input.txt") },
      createExecutionContext()
    )) as { path: string; content: string; sizeBytes: number };

    assert.equal(readResult.content, "hello from disk");
    assert.equal(readResult.path, join(realWorkspaceDir, "input.txt"));
    assert.equal(readResult.sizeBytes, Buffer.byteLength("hello from disk", "utf8"));

    const writeResult = (await writeFileTool.execute(
      {
        path: join(fixture.workspaceDir, "nested", "output.txt"),
        content: "generated content"
      },
      createExecutionContext()
    )) as { path: string; bytesWritten: number };

    assert.equal(writeResult.path, join(realWorkspaceDir, "nested", "output.txt"));
    assert.equal(writeResult.bytesWritten, Buffer.byteLength("generated content", "utf8"));
    assert.equal(readFileSync(join(fixture.workspaceDir, "nested", "output.txt"), "utf8"), "generated content");
  } finally {
    fixture.cleanup();
  }
});

test("read_file rejects paths outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
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

test("read_file rejects symlink escapes outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const outsideDir = join(fixture.fixtureDir, "outside");
    const symlinkPath = join(fixture.workspaceDir, "linked-outside");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.txt"), "top secret", "utf8");
    symlinkSync(outsideDir, symlinkPath, "dir");

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
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

test("write_file rejects symlink escapes outside authorized directories", async () => {
  const fixture = createTestFixture();

  try {
    const outsideDir = join(fixture.fixtureDir, "outside");
    const symlinkPath = join(fixture.workspaceDir, "linked-outside");
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, symlinkPath, "dir");

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
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

test("fetch_url fetches HTTPS text responses", async () => {
  const fixture = createTestFixture();
  const originalFetch = globalThis.fetch;
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      assert.equal(requestUrl, "https://example.com/article");
      assert.equal(init?.redirect, "manual");

      return new Response("hello from the network", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }) as typeof fetch;

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, { dnsLookup });
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
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});

test("fetch_url rejects non-HTTPS URLs", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
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
    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage);
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
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }]
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
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});

test("fetch_url rejects access to the local controller port", async () => {
  const fixture = createTestFixture();

  try {
    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, {
      controllerPort: 3030
    });
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://127.0.0.1:3030/health"
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
  const originalFetch = globalThis.fetch;
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    const seenUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seenUrls.push(requestUrl);

      if (requestUrl === "https://example.com/start") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/next"
          }
        });
      }

      return new Response("redirect complete", {
        status: 200,
        headers: {
          "content-type": "text/plain"
        }
      });
    }) as typeof fetch;

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, { dnsLookup });
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
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});

test("fetch_url rejects redirect chains beyond the limit", async () => {
  const fixture = createTestFixture();
  const originalFetch = globalThis.fetch;
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const step = Number.parseInt(new URL(requestUrl).pathname.replace("/", ""), 10);

      return new Response(null, {
        status: 302,
        headers: {
          location: `https://example.com/${step + 1}`
        }
      });
    }) as typeof fetch;

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, { dnsLookup });
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
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});

test("fetch_url rejects oversized responses", async () => {
  const fixture = createTestFixture();
  const originalFetch = globalThis.fetch;
  const dnsLookup: DnsLookupStub = async () => [{ address: "93.184.216.34", family: 4 }];

  try {
    globalThis.fetch = (async () => {
      return new Response("too big", {
        status: 200,
        headers: {
          "content-length": "1000001",
          "content-type": "text/plain"
        }
      });
    }) as typeof fetch;

    const runtimeTools = createRuntimeTools(fixture.workspaceDir, fixture.storage, { dnsLookup });
    const fetchUrlTool = runtimeTools.fetch_url!;

    await assert.rejects(
      fetchUrlTool.execute(
        {
          url: "https://example.com/large"
        },
        createExecutionContext()
      ),
      /response exceeded the size limit/
    );
  } finally {
    globalThis.fetch = originalFetch;
    fixture.cleanup();
  }
});
