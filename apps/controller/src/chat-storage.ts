import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { UIMessage } from "ai";

const DEFAULT_SESSION_TITLE = "New chat";
const DEFAULT_PROVIDER_ID = "pro_local-stub";
const DEFAULT_MODEL_ID = "mod_controller-echo";
const DEFAULT_PROVIDER_TYPE = "openai";
const DEFAULT_PROVIDER_DISPLAY_NAME = "Local Stub Provider";
const DEFAULT_MODEL_NAME = "controller-echo";
const DEFAULT_MODEL_DISPLAY_NAME = "Controller Echo";
const DEFAULT_UI_MESSAGE_SCHEMA_VERSION = "v1";

interface CreateChatStorageOptions {
  readonly databasePath: string;
}

interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
  readonly default_provider_id: string | null;
  readonly default_model_id: string | null;
}

interface ProviderRow {
  readonly id: string;
  readonly default_model_name: string | null;
}

interface ProviderModelRow {
  readonly id: string;
  readonly provider_id: string;
}

export interface ChatRequestPersistenceInput {
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly messages: UIMessage[];
  readonly maxSteps?: number;
}

export interface ResolvedChatRequest {
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly runId: string;
}

export class ChatStorageResolutionError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(options: { message: string; statusCode?: number; errorCode?: string }) {
    super(options.message);
    this.name = "ChatStorageResolutionError";
    this.statusCode = options.statusCode ?? 400;
    this.errorCode = options.errorCode ?? "invalid_request";
  }
}

export interface ChatStorage {
  prepareChatRequest(input: ChatRequestPersistenceInput): ResolvedChatRequest;
  completeRun(options: { runId: string; finishReason: string | null }): void;
  failRun(options: { runId: string; finishReason: string }): void;
  persistAssistantMessage(options: {
    sessionId: string;
    runId: string;
    providerId: string;
    modelId: string;
    message: UIMessage;
  }): void;
}

export function createChatStorage(options: CreateChatStorageOptions): ChatStorage {
  mkdirSync(dirname(options.databasePath), { recursive: true });

  const connection = new DatabaseSync(options.databasePath);

  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA foreign_keys = ON");

  bootstrapSchema(connection);
  ensureStubProviderAndModel(connection);

  return {
    prepareChatRequest(input) {
      const now = new Date().toISOString();
      const sessionId = input.sessionId?.trim() || createPrefixedId("ses");
      const session = getSession(connection, sessionId);
      const resolvedProviderId = input.providerId?.trim();
      const resolvedModelId = input.modelId?.trim();
      const target = resolveProviderAndModel(connection, {
        ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
        ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
        session
      });
      const runId = createPrefixedId("run");

      upsertSession(connection, {
        id: sessionId,
        title: session?.title ?? DEFAULT_SESSION_TITLE,
        createdAt: session?.created_at ?? now,
        updatedAt: now,
        defaultProviderId: target.providerId,
        defaultModelId: target.modelId
      });

      insertRun(connection, {
        id: runId,
        sessionId,
        providerId: target.providerId,
        modelId: target.modelId,
        maxSteps: Math.max(1, input.maxSteps ?? 1),
        startedAt: now
      });

      persistMessages(connection, {
        sessionId,
        runId,
        messages: input.messages,
        createdAt: now
      });

      return {
        sessionId,
        providerId: target.providerId,
        modelId: target.modelId,
        runId
      };
    },

    completeRun({ runId, finishReason }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE runs
           SET status = 'completed', finish_reason = ?, ended_at = ?
           WHERE id = ?`
        )
        .run(finishReason, endedAt, runId);
    },

    failRun({ runId, finishReason }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE runs
           SET status = 'failed', finish_reason = ?, ended_at = ?
           WHERE id = ?`
        )
        .run(finishReason, endedAt, runId);
    },

    persistAssistantMessage({ sessionId, runId, providerId, modelId, message }) {
      const createdAt = new Date().toISOString();

      persistMessages(connection, {
        sessionId,
        runId,
        messages: [message],
        createdAt
      });

      connection
        .prepare(
          `UPDATE sessions
           SET updated_at = ?, default_provider_id = COALESCE(default_provider_id, ?), default_model_id = COALESCE(default_model_id, ?)
           WHERE id = ?`
        )
        .run(createdAt, providerId, modelId, sessionId);
    }
  };
}

function bootstrapSchema(connection: DatabaseSync) {
  const hasSessionsTable = connection
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions' LIMIT 1")
    .get();

  if (hasSessionsTable) {
    return;
  }

  const migrationPath = resolve(__dirname, "../../../packages/database/migrations/0000_initial_schema.sql");
  const sql = readFileSync(migrationPath, "utf8");
  connection.exec(sql);
}

function ensureStubProviderAndModel(connection: DatabaseSync) {
  const now = new Date().toISOString();

  connection
    .prepare(
      `INSERT INTO providers (
        id,
        type,
        display_name,
        base_url,
        default_model_name,
        enabled,
        timeout_ms,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, NULL, ?, 1, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        default_model_name = excluded.default_model_name,
        updated_at = excluded.updated_at`
    )
    .run(
      DEFAULT_PROVIDER_ID,
      DEFAULT_PROVIDER_TYPE,
      DEFAULT_PROVIDER_DISPLAY_NAME,
      DEFAULT_MODEL_NAME,
      now,
      now
    );

  connection
    .prepare(
      `INSERT INTO provider_models (
        id,
        provider_id,
        model_name,
        display_name,
        supports_tools,
        supports_reasoning,
        enabled,
        capabilities_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, 1, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        model_name = excluded.model_name,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at`
    )
    .run(DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, DEFAULT_MODEL_NAME, DEFAULT_MODEL_DISPLAY_NAME, now, now);
}

function resolveProviderAndModel(
  connection: DatabaseSync,
  options: {
    providerId?: string;
    modelId?: string;
    session: SessionRow | undefined;
  }
) {
  if (options.providerId && options.modelId) {
    const provider = getProvider(connection, options.providerId);
    const model = getProviderModel(connection, options.modelId);

    if (!provider) {
      throw new ChatStorageResolutionError({ message: `Unknown providerId: ${options.providerId}` });
    }

    if (!model) {
      throw new ChatStorageResolutionError({ message: `Unknown modelId: ${options.modelId}` });
    }

    if (model.provider_id !== provider.id) {
      throw new ChatStorageResolutionError({ message: "The requested modelId does not belong to the requested providerId." });
    }

    return {
      providerId: provider.id,
      modelId: model.id
    };
  }

  if (options.modelId) {
    const model = getProviderModel(connection, options.modelId);

    if (!model) {
      throw new ChatStorageResolutionError({ message: `Unknown modelId: ${options.modelId}` });
    }

    return {
      providerId: model.provider_id,
      modelId: model.id
    };
  }

  if (options.providerId) {
    const provider = getProvider(connection, options.providerId);

    if (!provider) {
      throw new ChatStorageResolutionError({ message: `Unknown providerId: ${options.providerId}` });
    }

    const preferredModel = options.session?.default_model_id
      ? getProviderModel(connection, options.session.default_model_id)
      : undefined;

    if (preferredModel && preferredModel.provider_id === provider.id) {
      return {
        providerId: provider.id,
        modelId: preferredModel.id
      };
    }

    const defaultModel = provider.default_model_name
      ? getProviderModelByName(connection, provider.id, provider.default_model_name)
      : undefined;

    if (!defaultModel) {
      throw new ChatStorageResolutionError({
        message: "The requested providerId does not have a resolvable default model.",
        statusCode: 422,
        errorCode: "provider_model_unresolved"
      });
    }

    return {
      providerId: provider.id,
      modelId: defaultModel.id
    };
  }

  if (options.session?.default_model_id) {
    const model = getProviderModel(connection, options.session.default_model_id);

    if (model) {
      return {
        providerId: model.provider_id,
        modelId: model.id
      };
    }
  }

  if (options.session?.default_provider_id) {
    const provider = getProvider(connection, options.session.default_provider_id);

    if (provider?.default_model_name) {
      const defaultModel = getProviderModelByName(connection, provider.id, provider.default_model_name);

      if (defaultModel) {
        return {
          providerId: provider.id,
          modelId: defaultModel.id
        };
      }
    }
  }

  return {
    providerId: DEFAULT_PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID
  };
}

function getSession(connection: DatabaseSync, id: string) {
  return connection.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(id) as SessionRow | undefined;
}

function getProvider(connection: DatabaseSync, id: string) {
  return connection
    .prepare("SELECT id, default_model_name FROM providers WHERE id = ? AND enabled = 1 LIMIT 1")
    .get(id) as ProviderRow | undefined;
}

function getProviderModel(connection: DatabaseSync, id: string) {
  return connection
    .prepare("SELECT id, provider_id FROM provider_models WHERE id = ? AND enabled = 1 LIMIT 1")
    .get(id) as ProviderModelRow | undefined;
}

function getProviderModelByName(connection: DatabaseSync, providerId: string, modelName: string) {
  return connection
    .prepare("SELECT id, provider_id FROM provider_models WHERE provider_id = ? AND model_name = ? AND enabled = 1 LIMIT 1")
    .get(providerId, modelName) as ProviderModelRow | undefined;
}

function upsertSession(
  connection: DatabaseSync,
  session: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    defaultProviderId: string;
    defaultModelId: string;
  }
) {
  connection
    .prepare(
      `INSERT INTO sessions (
        id,
        title,
        created_at,
        updated_at,
        archived_at,
        default_provider_id,
        default_model_id
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        default_provider_id = excluded.default_provider_id,
        default_model_id = excluded.default_model_id`
    )
    .run(
      session.id,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.defaultProviderId,
      session.defaultModelId
    );
}

function insertRun(
  connection: DatabaseSync,
  run: {
    id: string;
    sessionId: string;
    providerId: string;
    modelId: string;
    maxSteps: number;
    startedAt: string;
  }
) {
  connection
    .prepare(
      `INSERT INTO runs (
        id,
        session_id,
        status,
        provider_id,
        model_id,
        current_step,
        max_steps,
        max_tokens_per_run,
        wall_clock_deadline_at,
        finish_reason,
        started_at,
        ended_at
      ) VALUES (?, ?, 'running', ?, ?, 0, ?, NULL, NULL, NULL, ?, NULL)`
    )
    .run(run.id, run.sessionId, run.providerId, run.modelId, run.maxSteps, run.startedAt);
}

function persistMessages(
  connection: DatabaseSync,
  options: {
    sessionId: string;
    runId: string;
    messages: UIMessage[];
    createdAt: string;
  }
) {
  const insertMessage = connection.prepare(
    `INSERT INTO messages (
      id,
      session_id,
      run_id,
      role,
      ui_message_json,
      ui_message_schema_version,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, idempotency_key) DO NOTHING`
  );

  const updateSession = connection.prepare(
    `UPDATE sessions
     SET updated_at = ?
     WHERE id = ?`
  );

  for (const message of options.messages) {
    insertMessage.run(
      message.id,
      options.sessionId,
      options.runId,
      message.role,
      JSON.stringify(message),
      DEFAULT_UI_MESSAGE_SCHEMA_VERSION,
      message.id,
      options.createdAt
    );
  }

  updateSession.run(options.createdAt, options.sessionId);
}

function createPrefixedId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
