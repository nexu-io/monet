import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createChatStorage } from "./chat-storage";

function createStorageFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "monet-chat-storage-tests-"));
  const databasePath = join(fixtureDir, "controller.sqlite");
  const workspaceDir = join(fixtureDir, "workspace");
  const secondaryDir = join(fixtureDir, "secondary");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(secondaryDir, { recursive: true });

  return {
    databasePath,
    fixtureDir,
    secondaryDir,
    workspaceDir,
    cleanup() {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  };
}

function createStorage(databasePath: string) {
  return createChatStorage({
    databasePath,
    openai: {
      baseUrl: null,
      defaultModel: "gpt-4.1-mini",
      timeoutMs: null
    },
    openrouter: {
      baseUrl: null,
      defaultModel: "openai/gpt-4.1-mini",
      timeoutMs: null
    }
  });
}

test("authorized directory allowlist persists across storage reopen", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const saved = storage.replaceAuthorizedDirectories([
      fixture.workspaceDir,
      `${fixture.workspaceDir}/../workspace`,
      fixture.secondaryDir,
      "   "
    ]);

    assert.deepEqual(
      saved.map((entry) => entry.path),
      [resolve(fixture.secondaryDir), resolve(fixture.workspaceDir)]
    );

    const reopenedStorage = createStorage(fixture.databasePath);

    assert.deepEqual(
      reopenedStorage.listAuthorizedDirectories().map((entry) => entry.path),
      [resolve(fixture.secondaryDir), resolve(fixture.workspaceDir)]
    );
  } finally {
    fixture.cleanup();
  }
});

test("storage bootstraps OpenAI and OpenRouter providers", () => {
  const fixture = createStorageFixture();

  try {
    const storage = createStorage(fixture.databasePath);
    const providers = storage.listProviders();

    assert.deepEqual(
      providers.map((provider) => ({
        type: provider.type,
        displayName: provider.displayName,
        defaultModelName: provider.defaultModelName
      })),
      [
        {
          type: "openai",
          displayName: "OpenAI",
          defaultModelName: "gpt-4.1-mini"
        },
        {
          type: "openrouter",
          displayName: "OpenRouter",
          defaultModelName: "openai/gpt-4.1-mini"
        }
      ]
    );
  } finally {
    fixture.cleanup();
  }
});
