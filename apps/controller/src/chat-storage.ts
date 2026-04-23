import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createId as createCuid2 } from "@paralleldrive/cuid2";
import type { UIMessage } from "ai";

const DEFAULT_SESSION_TITLE = "New chat";
const DEFAULT_OPENAI_PROVIDER_ID = "pro_b6m4q2r8t5v9x3z7k1n4p6s8";
const DEFAULT_OPENAI_MODEL_ID = "mod_c7n5r3t9w2y6k4m8p1s5v7x9";
const DEFAULT_OPENROUTER_PROVIDER_ID = "pro_q4w8e2r6t1y5u9i3o7p1a5s9";
const DEFAULT_OPENROUTER_MODEL_ID = "mod_h3j7k1l5z9x3c7v1b5n9m3q7";
const DEFAULT_PROVIDER_TYPE = "openai";
const DEFAULT_PROVIDER_DISPLAY_NAME = "OpenAI";
const DEFAULT_OPENROUTER_PROVIDER_DISPLAY_NAME = "OpenRouter";
const CURRENT_UI_MESSAGE_SCHEMA_VERSION = "v1";
const KNOWN_UI_MESSAGE_PART_TYPES = new Set([
  "text",
  "reasoning",
  "step-start",
  "file",
  "source-url",
  "source-document",
  "dynamic-tool"
]);

type ProviderType = "openai" | "openrouter";

interface CreateChatStorageOptions {
  readonly databasePath: string;
  readonly openai: {
    readonly baseUrl: string | null;
    readonly defaultModel: string;
    readonly timeoutMs: number | null;
  };
  readonly openrouter: {
    readonly baseUrl: string | null;
    readonly defaultModel: string;
    readonly timeoutMs: number | null;
  };
}

interface MigrationJournal {
  readonly entries?: MigrationJournalEntry[];
}

interface MigrationJournalEntry {
  readonly when: number;
  readonly tag: string;
  readonly breakpoints?: boolean;
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
  readonly type: ProviderType;
  readonly display_name: string;
  readonly base_url: string | null;
  readonly default_model_name: string | null;
  readonly enabled: number;
  readonly timeout_ms: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ProviderModelRow {
  readonly id: string;
  readonly provider_id: string;
  readonly model_name: string;
  readonly display_name: string;
  readonly supports_tools: number;
  readonly supports_reasoning: number;
  readonly enabled: number;
  readonly capabilities_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuthorizedDirectoryRow {
  readonly path: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface MessageRow {
  readonly id: string;
  readonly session_id: string;
  readonly run_id: string | null;
  readonly role: string;
  readonly ui_message_json: string;
  readonly ui_message_schema_version: string;
  readonly created_at: string;
}

interface RunRow {
  readonly id: string;
  readonly session_id: string;
  readonly status: string;
  readonly provider_id: string;
  readonly model_id: string;
  readonly current_step: number;
  readonly max_steps: number;
  readonly max_tokens_per_run: number | null;
  readonly wall_clock_deadline_at: string | null;
  readonly finish_reason: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

interface ToolCallRow {
  readonly id: string;
  readonly run_id: string;
  readonly tool_name: string;
  readonly input_json: string;
  readonly output_json: string | null;
  readonly output_truncated: number;
  readonly output_size_bytes: number | null;
  readonly approval_decision: "approved" | "rejected" | null;
  readonly approval_decided_at: string | null;
  readonly confirmation_token_hash: string | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

export interface StoredSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly defaultProviderId: string | null;
  readonly defaultModelId: string | null;
}

export interface StoredSessionMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly runId: string | null;
  readonly role: string;
  readonly createdAt: string;
  readonly uiMessage: unknown;
}

export interface StoredSessionDetail extends StoredSession {
  readonly messages: StoredSessionMessage[];
}

export interface StoredProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly displayName: string;
  readonly baseUrl: string | null;
  readonly defaultModelName: string | null;
  readonly enabled: boolean;
  readonly timeoutMs: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredProviderModel {
  readonly id: string;
  readonly providerId: string;
  readonly modelName: string;
  readonly displayName: string;
  readonly supportsTools: boolean;
  readonly supportsReasoning: boolean;
  readonly enabled: boolean;
  readonly capabilitiesJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredRunContext {
  readonly id: string;
  readonly sessionId: string;
  readonly status: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly currentStep: number;
  readonly maxSteps: number;
  readonly maxTokensPerRun: number | null;
  readonly wallClockDeadlineAt: string | null;
}

export interface ConfirmToolCallInput {
  readonly runId: string;
  readonly toolCallId: string;
  readonly decision: "approved" | "rejected";
  readonly confirmationToken: string;
}

export type ConfirmToolCallResult = "confirmed" | "already_confirmed";

export interface StoredAuthorizedDirectory {
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderValidationResult {
  readonly provider: StoredProvider;
  readonly valid: boolean;
  readonly reason:
    | "ok"
    | "disabled"
    | "no_enabled_models"
    | "missing_default_model"
    | "default_model_unresolved"
    | "missing_credentials"
    | "provider_api_error";
  readonly message: string;
  readonly defaultModelId: string | null;
  readonly defaultModelName: string | null;
  readonly availableModelCount: number;
}

export interface ProviderCatalogModelInput {
  readonly modelName: string;
  readonly displayName: string;
  readonly supportsTools: boolean;
  readonly supportsReasoning: boolean;
  readonly capabilitiesJson: string | null;
}

export interface ChatRequestPersistenceInput {
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly messages: UIMessage[];
  readonly maxSteps?: number;
  readonly maxTokensPerRun?: number | null;
  readonly wallClockDeadlineAt?: string | null;
}

export interface ResolvedChatRequest {
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly runId: string;
  readonly maxSteps: number;
  readonly maxTokensPerRun: number | null;
  readonly wallClockDeadlineAt: string | null;
}

export type InterruptRunResult = "interrupted" | "already_finished" | "not_found";

export interface RecoverUnfinishedRunsResult {
  readonly interruptedRunIds: string[];
  readonly failedRunIds: string[];
}

export interface CreateSessionInput {
  readonly title?: string;
  readonly providerId?: string;
  readonly modelId?: string;
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
  listAuthorizedDirectories(): StoredAuthorizedDirectory[];
  replaceAuthorizedDirectories(paths: readonly string[]): StoredAuthorizedDirectory[];
  listSessions(): StoredSession[];
  createSession(input: CreateSessionInput): StoredSession;
  getSessionDetail(sessionId: string): StoredSessionDetail;
  updateSessionTitle(input: { sessionId: string; title: string }): StoredSession;
  archiveSession(sessionId: string): StoredSession;
  listProviders(): StoredProvider[];
  getProvider(providerId: string): StoredProvider;
  listModels(providerId?: string): StoredProviderModel[];
  getModel(modelId: string): StoredProviderModel;
  validateProvider(providerId: string): ProviderValidationResult;
  replaceProviderCatalog(input: {
    providerId: string;
    defaultModelName?: string | null;
    models: ProviderCatalogModelInput[];
  }): void;
  prepareChatRequest(input: ChatRequestPersistenceInput): ResolvedChatRequest;
  getRunContext(runId: string): StoredRunContext;
  persistRunMessages(options: { sessionId: string; runId: string; messages: UIMessage[] }): void;
  recoverUnfinishedRuns(): RecoverUnfinishedRunsResult;
  startToolCall(options: { toolCallId?: string; runId: string; toolName: string; input: unknown }): string;
  markToolCallRunning(toolCallId: string): void;
  recordToolApprovalRequest(options: { toolCallId: string; confirmationToken: string }): void;
  confirmToolCall(input: ConfirmToolCallInput): ConfirmToolCallResult;
  completeToolCall(options: {
    toolCallId: string;
    output: unknown;
  }): {
    outputSizeBytes: number;
    outputTruncated: boolean;
  };
  failToolCall(options: { toolCallId: string; errorMessage: string }): void;
  markRunAwaitingConfirmation(runId: string): void;
  resumeRun(runId: string): void;
  updateRunProgress(options: { runId: string; currentStep: number }): void;
  completeRun(options: { runId: string; finishReason: string | null }): void;
  failRun(options: { runId: string; finishReason: string }): void;
  interruptRun(options: { runId: string; finishReason: string }): InterruptRunResult;
  persistAssistantMessage(options: {
    sessionId: string;
    runId: string;
    providerId: string;
    modelId: string;
    message: UIMessage;
  }): void;
}

export function createChatStorage(options: CreateChatStorageOptions): ChatStorage {
  const databaseDirectory = dirname(options.databasePath);

  mkdirSync(databaseDirectory, {
    recursive: true,
    mode: 0o700
  });
  ensureOwnerOnlyPathPermissions(databaseDirectory, 0o700);

  const connection = new DatabaseSync(options.databasePath);
  ensureSqliteFilePermissions(options.databasePath);

  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA synchronous = NORMAL");
  connection.exec("PRAGMA busy_timeout = 5000");
  connection.exec("PRAGMA foreign_keys = ON");

  bootstrapSchema(connection);
  ensureProviderAndDefaultModel(connection, {
    providerId: DEFAULT_OPENAI_PROVIDER_ID,
    providerType: DEFAULT_PROVIDER_TYPE,
    providerDisplayName: DEFAULT_PROVIDER_DISPLAY_NAME,
    modelId: DEFAULT_OPENAI_MODEL_ID,
    baseUrl: options.openai.baseUrl,
    defaultModel: options.openai.defaultModel,
    timeoutMs: options.openai.timeoutMs
  });
  ensureProviderAndDefaultModel(connection, {
    providerId: DEFAULT_OPENROUTER_PROVIDER_ID,
    providerType: "openrouter",
    providerDisplayName: DEFAULT_OPENROUTER_PROVIDER_DISPLAY_NAME,
    modelId: DEFAULT_OPENROUTER_MODEL_ID,
    baseUrl: options.openrouter.baseUrl,
    defaultModel: options.openrouter.defaultModel,
    timeoutMs: options.openrouter.timeoutMs
  });
  ensureSqliteFilePermissions(options.databasePath);

  return {
    listAuthorizedDirectories() {
      const rows = connection
        .prepare(
          `SELECT path, created_at, updated_at
           FROM authorized_directories
           ORDER BY path ASC`
        )
        .all() as unknown as AuthorizedDirectoryRow[];

      return rows.map(mapAuthorizedDirectoryRow);
    },

    replaceAuthorizedDirectories(paths) {
      const normalizedPaths = normalizeAuthorizedDirectoryPaths(paths);
      const now = new Date().toISOString();
      const insertStatement = connection.prepare(
        `INSERT INTO authorized_directories (path, created_at, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at`
      );

      connection.exec("BEGIN IMMEDIATE");

      try {
        connection.exec("DELETE FROM authorized_directories");

        for (const path of normalizedPaths) {
          insertStatement.run(path, now, now);
        }

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return this.listAuthorizedDirectories();
    },

    listSessions() {
      const rows = connection
        .prepare(
          `SELECT id, title, created_at, updated_at, archived_at, default_provider_id, default_model_id
           FROM sessions
           ORDER BY archived_at IS NOT NULL ASC, updated_at DESC, created_at DESC`
        )
        .all() as unknown as SessionRow[];

      return rows.map(mapSessionRow);
    },

    createSession(input) {
      const now = new Date().toISOString();
      const sessionId = createPrefixedId("ses");
      const resolvedProviderId = input.providerId?.trim();
      const resolvedModelId = input.modelId?.trim();
      const target =
        resolvedProviderId || resolvedModelId
          ? resolveProviderAndModel(connection, {
              ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
              ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
              session: undefined
            })
          : null;

      upsertSession(connection, {
        id: sessionId,
        title: input.title?.trim() || DEFAULT_SESSION_TITLE,
        createdAt: now,
        updatedAt: now,
        defaultProviderId: target?.providerId ?? null,
        defaultModelId: target?.modelId ?? null
      });

      return getSessionOrThrow(connection, sessionId);
    },

    getSessionDetail(sessionId) {
      const session = getSession(connection, sessionId);

      if (!session) {
        throw new ChatStorageResolutionError({
          message: `Unknown sessionId: ${sessionId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      return {
        ...mapSessionRow(session),
        messages: listSessionMessages(connection, sessionId)
      };
    },

    updateSessionTitle({ sessionId, title }) {
      const session = getSession(connection, sessionId);

      if (!session) {
        throw new ChatStorageResolutionError({
          message: `Unknown sessionId: ${sessionId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();

      connection
        .prepare(
          `UPDATE sessions
           SET title = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(title.trim(), now, sessionId);

      return getSessionOrThrow(connection, sessionId);
    },

    archiveSession(sessionId) {
      const session = getSession(connection, sessionId);

      if (!session) {
        throw new ChatStorageResolutionError({
          message: `Unknown sessionId: ${sessionId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();

      connection
        .prepare(
          `UPDATE sessions
           SET archived_at = COALESCE(archived_at, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(now, now, sessionId);

      return getSessionOrThrow(connection, sessionId);
    },

    listProviders() {
      const rows = connection
        .prepare(
          `SELECT id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at
           FROM providers
           ORDER BY enabled DESC, display_name ASC, created_at ASC`
        )
        .all() as unknown as ProviderRow[];

      return rows.map(mapProviderRow);
    },

    getProvider(providerId) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      return mapProviderRow(provider);
    },

    listModels(providerId) {
      if (providerId) {
        const provider = getProviderById(connection, providerId);

        if (!provider) {
          throw new ChatStorageResolutionError({
            message: `Unknown providerId: ${providerId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }
      }

      const rows = providerId
        ? ((connection
            .prepare(
              `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
               FROM provider_models
               WHERE provider_id = ?
               ORDER BY enabled DESC, display_name ASC, created_at ASC`
            )
            .all(providerId) as unknown) as ProviderModelRow[])
        : ((connection
            .prepare(
              `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
               FROM provider_models
               ORDER BY enabled DESC, provider_id ASC, display_name ASC, created_at ASC`
            )
            .all() as unknown) as ProviderModelRow[]);

      return rows.map(mapProviderModelRow);
    },

    getModel(modelId) {
      const model = getProviderModelById(connection, modelId);

      if (!model) {
        throw new ChatStorageResolutionError({
          message: `Unknown modelId: ${modelId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      return mapProviderModelRow(model);
    },

    validateProvider(providerId) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const models = connection
        .prepare(
          `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
           FROM provider_models
           WHERE provider_id = ? AND enabled = 1
           ORDER BY display_name ASC, created_at ASC`
        )
        .all(providerId) as unknown as ProviderModelRow[];
      const defaultModel = provider.default_model_name
        ? models.find((model) => model.model_name === provider.default_model_name) ?? null
        : null;

      if (!provider.enabled) {
        return {
          provider: mapProviderRow(provider),
          valid: false,
          reason: "disabled",
          message: "Provider is disabled.",
          defaultModelId: null,
          defaultModelName: provider.default_model_name,
          availableModelCount: models.length
        };
      }

      if (models.length === 0) {
        return {
          provider: mapProviderRow(provider),
          valid: false,
          reason: "no_enabled_models",
          message: "Provider does not have any enabled models.",
          defaultModelId: null,
          defaultModelName: provider.default_model_name,
          availableModelCount: 0
        };
      }

      if (!provider.default_model_name) {
        return {
          provider: mapProviderRow(provider),
          valid: false,
          reason: "missing_default_model",
          message: "Provider is missing a default model configuration.",
          defaultModelId: null,
          defaultModelName: null,
          availableModelCount: models.length
        };
      }

      if (!defaultModel) {
        return {
          provider: mapProviderRow(provider),
          valid: false,
          reason: "default_model_unresolved",
          message: "Provider default model could not be resolved from enabled models.",
          defaultModelId: null,
          defaultModelName: provider.default_model_name,
          availableModelCount: models.length
        };
      }

      return {
        provider: mapProviderRow(provider),
        valid: true,
        reason: "ok",
        message: "Provider configuration is valid.",
        defaultModelId: defaultModel.id,
        defaultModelName: defaultModel.model_name,
        availableModelCount: models.length
      };
    },

    replaceProviderCatalog({ providerId, defaultModelName, models }) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();
      const disableModelsStatement = connection.prepare(
        `UPDATE provider_models
         SET enabled = 0, updated_at = ?
         WHERE provider_id = ?`
      );
      const upsertModelStatement = connection.prepare(
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
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(provider_id, model_name) DO UPDATE SET
          display_name = excluded.display_name,
          supports_tools = excluded.supports_tools,
          supports_reasoning = excluded.supports_reasoning,
          enabled = excluded.enabled,
          capabilities_json = excluded.capabilities_json,
          updated_at = excluded.updated_at`
      );

      connection.exec("BEGIN");

      try {
        connection
          .prepare(
            `UPDATE providers
             SET default_model_name = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(defaultModelName ?? provider.default_model_name, now, providerId);

        disableModelsStatement.run(now, providerId);

        for (const model of models) {
          const existingModel = getProviderModelByProviderAndName(connection, providerId, model.modelName);

          upsertModelStatement.run(
            existingModel?.id ?? createPrefixedId("mod"),
            providerId,
            model.modelName,
            model.displayName,
            model.supportsTools ? 1 : 0,
            model.supportsReasoning ? 1 : 0,
            model.capabilitiesJson,
            existingModel?.created_at ?? now,
            now
          );
        }

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

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
        maxTokensPerRun: input.maxTokensPerRun ?? null,
        wallClockDeadlineAt: input.wallClockDeadlineAt ?? null,
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
        runId,
        maxSteps: Math.max(1, input.maxSteps ?? 1),
        maxTokensPerRun: input.maxTokensPerRun ?? null,
        wallClockDeadlineAt: input.wallClockDeadlineAt ?? null
      };
    },

    getRunContext(runId) {
      const run = getRunRow(connection, runId);

      if (!run) {
        throw new ChatStorageResolutionError({
          message: `Unknown runId: ${runId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      return mapRunRow(run);
    },

    persistRunMessages({ sessionId, runId, messages }) {
      persistMessages(connection, {
        sessionId,
        runId,
        messages,
        createdAt: new Date().toISOString()
      });
    },

    recoverUnfinishedRuns() {
      const interruptedRunIds = listRunIdsByStatus(connection, "running");
      const failedRunIds = listRunIdsByStatus(connection, "pending");
      const endedAt = new Date().toISOString();

      connection.exec("BEGIN IMMEDIATE");

      try {
        if (interruptedRunIds.length > 0) {
          connection
            .prepare(
              `UPDATE runs
               SET status = 'interrupted', finish_reason = 'startup_recovery', ended_at = ?
               WHERE status = 'running'`
            )
            .run(endedAt);
        }

        if (failedRunIds.length > 0) {
          connection
            .prepare(
              `UPDATE runs
               SET status = 'failed', finish_reason = 'startup_recovery', ended_at = ?
               WHERE status = 'pending'`
            )
            .run(endedAt);
        }

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return {
        interruptedRunIds,
        failedRunIds
      };
    },

    startToolCall({ toolCallId, runId, toolName, input }) {
      const startedAt = new Date().toISOString();
      const persistedToolCallId = toolCallId?.trim() || createPrefixedId("tcl");

      connection
        .prepare(
          `INSERT INTO tool_calls (
             id,
             run_id,
             tool_name,
             input_json,
             output_json,
             output_truncated,
             output_size_bytes,
             approval_decision,
             approval_decided_at,
             confirmation_token_hash,
             status,
             error_message,
             started_at,
             ended_at
           ) VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, 'pending', NULL, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             run_id = excluded.run_id,
             tool_name = excluded.tool_name,
             input_json = excluded.input_json`
        )
        .run(persistedToolCallId, runId, toolName, serializeToolCallPayload(input), startedAt);

      return persistedToolCallId;
    },

    markToolCallRunning(toolCallId) {
      connection
        .prepare(
          `UPDATE tool_calls
           SET status = 'running',
               error_message = NULL,
               ended_at = NULL
           WHERE id = ? AND status != 'completed'`
        )
        .run(toolCallId);
    },

    recordToolApprovalRequest({ toolCallId, confirmationToken }) {
      connection
        .prepare(
          `UPDATE tool_calls
           SET confirmation_token_hash = ?,
               approval_decision = NULL,
               approval_decided_at = NULL,
               status = 'pending',
               error_message = NULL,
               ended_at = NULL
           WHERE id = ?`
        )
        .run(hashConfirmationToken(confirmationToken), toolCallId);
    },

    confirmToolCall({ runId, toolCallId, decision, confirmationToken }) {
      const toolCall = getToolCallRow(connection, toolCallId);

      if (!toolCall || toolCall.run_id !== runId) {
        throw new ChatStorageResolutionError({
          message: "Tool call not found for this run.",
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      if (!toolCall.confirmation_token_hash) {
        throw new ChatStorageResolutionError({
          message: "Tool call is not awaiting confirmation.",
          statusCode: 409,
          errorCode: "invalid_state"
        });
      }

      if (toolCall.confirmation_token_hash !== hashConfirmationToken(confirmationToken)) {
        throw new ChatStorageResolutionError({
          message: "Confirmation token is invalid.",
          statusCode: 403,
          errorCode: "forbidden"
        });
      }

      if (toolCall.approval_decision) {
        if (toolCall.approval_decision === decision) {
          return "already_confirmed";
        }

        throw new ChatStorageResolutionError({
          message: "Tool call confirmation already recorded.",
          statusCode: 409,
          errorCode: "invalid_state"
        });
      }

      const decidedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE tool_calls
           SET approval_decision = ?,
               approval_decided_at = ?,
               status = CASE WHEN ? = 'rejected' THEN 'failed' ELSE status END,
               error_message = CASE WHEN ? = 'rejected' THEN 'Tool execution rejected by user.' ELSE NULL END,
               ended_at = CASE WHEN ? = 'rejected' THEN ? ELSE ended_at END
           WHERE id = ?`
        )
        .run(decision, decidedAt, decision, decision, decision, decidedAt, toolCallId);

      return "confirmed";
    },

    completeToolCall({ toolCallId, output }) {
      const endedAt = new Date().toISOString();
      const serializedOutput = serializeToolCallOutput(output);

      connection
        .prepare(
          `UPDATE tool_calls
           SET status = 'completed',
               output_json = ?,
               output_truncated = ?,
               output_size_bytes = ?,
               error_message = NULL,
               ended_at = ?
           WHERE id = ?`
        )
        .run(
          serializedOutput.value,
          serializedOutput.outputTruncated ? 1 : 0,
          serializedOutput.outputSizeBytes,
          endedAt,
          toolCallId
        );

      return {
        outputSizeBytes: serializedOutput.outputSizeBytes,
        outputTruncated: serializedOutput.outputTruncated
      };
    },

    failToolCall({ toolCallId, errorMessage }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE tool_calls
           SET status = 'failed',
               error_message = ?,
               ended_at = ?
           WHERE id = ?`
        )
        .run(errorMessage, endedAt, toolCallId);
    },

    markRunAwaitingConfirmation(runId) {
      connection
        .prepare(
          `UPDATE runs
           SET status = 'pending', finish_reason = 'awaiting_confirmation', ended_at = NULL
           WHERE id = ? AND status = 'running'`
        )
        .run(runId);
    },

    resumeRun(runId) {
      connection
        .prepare(
          `UPDATE runs
           SET status = 'running', finish_reason = NULL, ended_at = NULL
           WHERE id = ? AND status = 'pending'`
        )
        .run(runId);
    },

    updateRunProgress({ runId, currentStep }) {
      const normalizedCurrentStep = Math.max(0, currentStep);

      connection
        .prepare(
          `UPDATE runs
           SET current_step = CASE
             WHEN current_step > ? THEN current_step
             ELSE ?
           END
           WHERE id = ?`
        )
        .run(normalizedCurrentStep, normalizedCurrentStep, runId);
    },

    completeRun({ runId, finishReason }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE runs
           SET status = 'completed', finish_reason = ?, ended_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(finishReason, endedAt, runId);
    },

    failRun({ runId, finishReason }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE runs
           SET status = 'failed', finish_reason = ?, ended_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(finishReason, endedAt, runId);
    },

    interruptRun({ runId, finishReason }) {
      const endedAt = new Date().toISOString();
      const interruptedRunningRun = connection
        .prepare(
          `UPDATE runs
           SET status = 'interrupted', finish_reason = ?, ended_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(finishReason, endedAt, runId);

      if (interruptedRunningRun.changes > 0) {
        return "interrupted";
      }

      const interruptedPendingRun = connection
        .prepare(
          `UPDATE runs
           SET status = 'interrupted', finish_reason = ?, ended_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(finishReason, endedAt, runId);

      if (interruptedPendingRun.changes > 0) {
        return "interrupted";
      }

      const existingRun = connection.prepare(`SELECT status FROM runs WHERE id = ?`).get(runId) as
        | { status: string }
        | undefined;

      if (!existingRun) {
        return "not_found";
      }

      return "already_finished";
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

function ensureSqliteFilePermissions(databasePath: string) {
  for (const targetPath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!existsSync(targetPath)) {
      continue;
    }

    ensureOwnerOnlyPathPermissions(targetPath, 0o600);
  }
}

function ensureOwnerOnlyPathPermissions(targetPath: string, mode: number) {
  if (process.platform === "win32") {
    return;
  }

  try {
    chmodSync(targetPath, mode);
  } catch {
    // Best effort only: some runtimes enforce a stricter umask or filesystem policy.
  }
}

function listRunIdsByStatus(connection: DatabaseSync, status: string) {
  const rows = connection.prepare(`SELECT id FROM runs WHERE status = ?`).all(status) as Array<{ id: string }>;

  return rows.map((row) => row.id);
}

function getRunRow(connection: DatabaseSync, runId: string) {
  return connection
    .prepare(
      `SELECT id, session_id, status, provider_id, model_id, current_step, max_steps, max_tokens_per_run, wall_clock_deadline_at, finish_reason, started_at, ended_at
       FROM runs
       WHERE id = ?
       LIMIT 1`
    )
    .get(runId) as RunRow | undefined;
}

function getToolCallRow(connection: DatabaseSync, toolCallId: string) {
  return connection
    .prepare(
      `SELECT id, run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, approval_decision, approval_decided_at, confirmation_token_hash, status, error_message, started_at, ended_at
       FROM tool_calls
       WHERE id = ?
       LIMIT 1`
    )
    .get(toolCallId) as ToolCallRow | undefined;
}

function bootstrapSchema(connection: DatabaseSync) {
  const migrationsDirectory = resolve(process.env.MONET_MIGRATIONS_DIR?.trim() || resolve(__dirname, "../../../packages/database/migrations"));
  const journalPath = resolve(migrationsDirectory, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  const entries = Array.isArray(journal.entries) ? [...journal.entries].sort((left, right) => left.when - right.when) : [];

  ensureDrizzleMigrationsTable(connection);

  const latestAppliedMigration = connection
    .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as { created_at: number | null } | undefined;
  const lastAppliedAt = typeof latestAppliedMigration?.created_at === "number" ? latestAppliedMigration.created_at : -1;

  for (const entry of entries) {
    if (!isValidMigrationEntry(entry) || entry.when <= lastAppliedAt) {
      continue;
    }

    const migrationPath = resolve(migrationsDirectory, `${entry.tag}.sql`);
    const sql = readFileSync(migrationPath, "utf8");
    const statements = splitMigrationStatements(sql, entry.breakpoints ?? false);
    const hash = createHash("sha256").update(sql).digest("hex");

    connection.exec("BEGIN");

    try {
      for (const statement of statements) {
        connection.exec(statement);
      }

      connection
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(hash, entry.when);

      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
}

function ensureDrizzleMigrationsTable(connection: DatabaseSync) {
  connection.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    hash text NOT NULL,
    created_at numeric
  )`);
}

function isValidMigrationEntry(entry: MigrationJournalEntry | undefined): entry is MigrationJournalEntry {
  return Boolean(entry && typeof entry.tag === "string" && entry.tag.trim().length > 0 && Number.isFinite(entry.when));
}

function splitMigrationStatements(sql: string, hasBreakpoints: boolean) {
  if (hasBreakpoints) {
    return sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
  }

  const statement = sql.trim();

  return statement.length > 0 ? [statement] : [];
}

function ensureProviderAndDefaultModel(
  connection: DatabaseSync,
  options: {
    readonly providerId: string;
    readonly providerType: ProviderType;
    readonly providerDisplayName: string;
    readonly modelId: string;
    readonly baseUrl: string | null;
    readonly defaultModel: string;
    readonly timeoutMs: number | null;
  }
) {
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
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        base_url = excluded.base_url,
        default_model_name = excluded.default_model_name,
        timeout_ms = excluded.timeout_ms,
        updated_at = excluded.updated_at`
    )
    .run(
      options.providerId,
      options.providerType,
      options.providerDisplayName,
      options.baseUrl,
      options.defaultModel,
      options.timeoutMs,
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
      ) VALUES (?, ?, ?, ?, 1, ?, 1, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        model_name = excluded.model_name,
        display_name = excluded.display_name,
        supports_tools = excluded.supports_tools,
        supports_reasoning = excluded.supports_reasoning,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`
    )
    .run(
      options.modelId,
      options.providerId,
      options.defaultModel,
      options.defaultModel,
      isReasoningModelName(options.defaultModel) ? 1 : 0,
      now,
      now
    );
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
    const provider = getEnabledProvider(connection, options.providerId);
    const model = getEnabledProviderModel(connection, options.modelId);

    if (!provider) {
      const existingProvider = getProviderById(connection, options.providerId);

      throw new ChatStorageResolutionError({
        message: existingProvider ? `Provider is disabled: ${options.providerId}` : `Unknown providerId: ${options.providerId}`,
        statusCode: existingProvider ? 422 : 400,
        errorCode: existingProvider ? "provider_disabled" : "invalid_request"
      });
    }

    if (!model) {
      const existingModel = getProviderModelById(connection, options.modelId);

      throw new ChatStorageResolutionError({
        message: existingModel ? `Model is disabled: ${options.modelId}` : `Unknown modelId: ${options.modelId}`,
        statusCode: existingModel ? 422 : 400,
        errorCode: existingModel ? "model_disabled" : "invalid_request"
      });
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
    const model = getEnabledProviderModel(connection, options.modelId);

    if (!model) {
      const existingModel = getProviderModelById(connection, options.modelId);

      throw new ChatStorageResolutionError({
        message: existingModel ? `Model is disabled: ${options.modelId}` : `Unknown modelId: ${options.modelId}`,
        statusCode: existingModel ? 422 : 400,
        errorCode: existingModel ? "model_disabled" : "invalid_request"
      });
    }

    return {
      providerId: model.provider_id,
      modelId: model.id
    };
  }

  if (options.providerId) {
    const provider = getEnabledProvider(connection, options.providerId);

    if (!provider) {
      const existingProvider = getProviderById(connection, options.providerId);

      throw new ChatStorageResolutionError({
        message: existingProvider ? `Provider is disabled: ${options.providerId}` : `Unknown providerId: ${options.providerId}`,
        statusCode: existingProvider ? 422 : 400,
        errorCode: existingProvider ? "provider_disabled" : "invalid_request"
      });
    }

    const preferredModel = options.session?.default_model_id
      ? getEnabledProviderModel(connection, options.session.default_model_id)
      : undefined;

    if (preferredModel && preferredModel.provider_id === provider.id) {
      return {
        providerId: provider.id,
        modelId: preferredModel.id
      };
    }

    const defaultModel = provider.default_model_name
      ? getEnabledProviderModelByName(connection, provider.id, provider.default_model_name)
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
    const model = getEnabledProviderModel(connection, options.session.default_model_id);

    if (model) {
      return {
        providerId: model.provider_id,
        modelId: model.id
      };
    }
  }

  if (options.session?.default_provider_id) {
    const provider = getEnabledProvider(connection, options.session.default_provider_id);

    if (provider?.default_model_name) {
      const defaultModel = getEnabledProviderModelByName(connection, provider.id, provider.default_model_name);

      if (defaultModel) {
        return {
          providerId: provider.id,
          modelId: defaultModel.id
        };
      }
    }
  }

  return {
    providerId: DEFAULT_OPENAI_PROVIDER_ID,
    modelId: DEFAULT_OPENAI_MODEL_ID
  };
}

function getSession(connection: DatabaseSync, id: string) {
  return connection.prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1").get(id) as SessionRow | undefined;
}

function getSessionOrThrow(connection: DatabaseSync, id: string) {
  const session = getSession(connection, id);

  if (!session) {
    throw new ChatStorageResolutionError({
      message: `Unknown sessionId: ${id}`,
      statusCode: 404,
      errorCode: "not_found"
    });
  }

  return mapSessionRow(session);
}

function getEnabledProvider(connection: DatabaseSync, id: string) {
  return connection
    .prepare(
      `SELECT id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at
       FROM providers
       WHERE id = ? AND enabled = 1
       LIMIT 1`
    )
    .get(id) as ProviderRow | undefined;
}

function getProviderById(connection: DatabaseSync, id: string) {
  return connection
    .prepare(
      `SELECT id, type, display_name, base_url, default_model_name, enabled, timeout_ms, created_at, updated_at
       FROM providers
       WHERE id = ?
       LIMIT 1`
    )
    .get(id) as ProviderRow | undefined;
}

function getEnabledProviderModel(connection: DatabaseSync, id: string) {
  return connection
    .prepare(
      `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
       FROM provider_models
       WHERE id = ? AND enabled = 1
       LIMIT 1`
    )
    .get(id) as ProviderModelRow | undefined;
}

function getProviderModelById(connection: DatabaseSync, id: string) {
  return connection
    .prepare(
      `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
       FROM provider_models
       WHERE id = ?
       LIMIT 1`
    )
    .get(id) as ProviderModelRow | undefined;
}

function getProviderModelByProviderAndName(connection: DatabaseSync, providerId: string, modelName: string) {
  return connection
    .prepare(
      `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
       FROM provider_models
       WHERE provider_id = ? AND model_name = ?
       LIMIT 1`
    )
    .get(providerId, modelName) as ProviderModelRow | undefined;
}

function getEnabledProviderModelByName(connection: DatabaseSync, providerId: string, modelName: string) {
  return connection
    .prepare(
      `SELECT id, provider_id, model_name, display_name, supports_tools, supports_reasoning, enabled, capabilities_json, created_at, updated_at
       FROM provider_models
       WHERE provider_id = ? AND model_name = ? AND enabled = 1
       LIMIT 1`
    )
    .get(providerId, modelName) as ProviderModelRow | undefined;
}

function upsertSession(
  connection: DatabaseSync,
  session: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    defaultProviderId: string | null;
    defaultModelId: string | null;
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
    maxTokensPerRun: number | null;
    wallClockDeadlineAt: string | null;
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
      ) VALUES (?, ?, 'running', ?, ?, 0, ?, ?, ?, NULL, ?, NULL)`
    )
    .run(
      run.id,
      run.sessionId,
      run.providerId,
      run.modelId,
      run.maxSteps,
      run.maxTokensPerRun,
      run.wallClockDeadlineAt,
      run.startedAt
    );
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
    ON CONFLICT(session_id, idempotency_key) DO UPDATE SET
      run_id = excluded.run_id,
      role = excluded.role,
      ui_message_json = excluded.ui_message_json,
      ui_message_schema_version = excluded.ui_message_schema_version`
  );

  const updateSession = connection.prepare(
    `UPDATE sessions
     SET updated_at = ?
     WHERE id = ?`
  );

  for (const message of options.messages) {
    const persistedMessage = normalizePersistedMessage(message);

    insertMessage.run(
      persistedMessage.id,
      options.sessionId,
      options.runId,
      persistedMessage.message.role,
      JSON.stringify(persistedMessage.message),
      CURRENT_UI_MESSAGE_SCHEMA_VERSION,
      persistedMessage.idempotencyKey,
      options.createdAt
    );
  }

  updateSession.run(options.createdAt, options.sessionId);
}

function listSessionMessages(connection: DatabaseSync, sessionId: string) {
  const rows = connection
    .prepare(
      `SELECT id, session_id, run_id, role, ui_message_json, ui_message_schema_version, created_at
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(sessionId) as unknown as MessageRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    role: row.role,
    createdAt: row.created_at,
    uiMessage: parseStoredUiMessage(row.ui_message_json, row.ui_message_schema_version, {
      id: row.id,
      role: row.role
    })
  }));
}

function mapSessionRow(row: SessionRow): StoredSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    defaultProviderId: row.default_provider_id,
    defaultModelId: row.default_model_id
  };
}

function mapRunRow(row: RunRow): StoredRunContext {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    providerId: row.provider_id,
    modelId: row.model_id,
    currentStep: row.current_step,
    maxSteps: row.max_steps,
    maxTokensPerRun: row.max_tokens_per_run,
    wallClockDeadlineAt: row.wall_clock_deadline_at
  };
}

function mapAuthorizedDirectoryRow(row: AuthorizedDirectoryRow): StoredAuthorizedDirectory {
  return {
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProviderRow(row: ProviderRow): StoredProvider {
  return {
    id: row.id,
    type: row.type,
    displayName: row.display_name,
    baseUrl: row.base_url,
    defaultModelName: row.default_model_name,
    enabled: Boolean(row.enabled),
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAuthorizedDirectoryPaths(paths: readonly string[]) {
  return Array.from(new Set(paths.map((path) => resolve(path.trim())).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function mapProviderModelRow(row: ProviderModelRow): StoredProviderModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelName: row.model_name,
    displayName: row.display_name,
    supportsTools: Boolean(row.supports_tools),
    supportsReasoning: Boolean(row.supports_reasoning),
    enabled: Boolean(row.enabled),
    capabilitiesJson: row.capabilities_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStoredUiMessage(
  uiMessageJson: string,
  schemaVersion: string,
  fallback: {
    id: string;
    role: string;
  }
) {
  try {
    const parsed = JSON.parse(uiMessageJson) as unknown;

    return upcastStoredUiMessage(parsed, schemaVersion, fallback);
  } catch {
    return createFallbackUiMessage({
      fallback,
      schemaVersion,
      raw: uiMessageJson,
      reason: "invalid-json"
    });
  }
}

function upcastStoredUiMessage(
  message: unknown,
  schemaVersion: string,
  fallback: {
    id: string;
    role: string;
  }
) {
  if (!isObjectRecord(message)) {
    return createFallbackUiMessage({
      fallback,
      schemaVersion,
      raw: message,
      reason: "invalid-message-shape"
    });
  }

  const normalizedParts = Array.isArray(message.parts)
    ? message.parts.map((part) => normalizeStoredUiMessagePart(part, schemaVersion))
    : "parts" in message
      ? [
          createUnknownUiMessagePart({
            raw: message.parts,
            schemaVersion,
            reason: "invalid-parts-array"
          })
        ]
      : [];

  return {
    ...message,
    id: typeof message.id === "string" && message.id.trim().length > 0 ? message.id : fallback.id,
    role: normalizeStoredMessageRole(message.role, fallback.role),
    parts: normalizedParts
  };
}

function normalizeStoredUiMessagePart(part: unknown, schemaVersion: string) {
  if (!isObjectRecord(part) || typeof part.type !== "string") {
    return createUnknownUiMessagePart({
      raw: part,
      schemaVersion,
      reason: "invalid-part-shape"
    });
  }

  if (!isKnownUiMessagePart(part)) {
    return createUnknownUiMessagePart({
      raw: part,
      schemaVersion,
      originalType: part.type,
      reason: schemaVersion === CURRENT_UI_MESSAGE_SCHEMA_VERSION ? "unsupported-part" : "upcast-required"
    });
  }

  return part;
}

function isKnownUiMessagePart(part: Record<string, unknown>) {
  const type = typeof part.type === "string" ? part.type : null;

  if (!type) {
    return false;
  }

  if (type.startsWith("tool-")) {
    return typeof part.toolName === "string" && typeof part.state === "string";
  }

  if (!KNOWN_UI_MESSAGE_PART_TYPES.has(type)) {
    return false;
  }

  switch (type) {
    case "text":
    case "reasoning":
      return typeof part.text === "string";
    case "step-start":
      return typeof part.title === "string";
    case "file":
      return typeof part.filename === "string";
    case "source-url":
      return typeof part.title === "string" && typeof part.url === "string";
    case "source-document":
      return typeof part.title === "string";
    case "dynamic-tool":
      return typeof part.toolName === "string" && typeof part.state === "string";
    default:
      return false;
  }
}

function createUnknownUiMessagePart(options: {
  raw: unknown;
  schemaVersion: string;
  originalType?: string;
  reason: string;
}) {
  return {
    type: "unknown",
    schemaVersion: options.schemaVersion,
    reason: options.reason,
    ...(options.originalType ? { originalType: options.originalType } : {}),
    raw: options.raw
  };
}

function createFallbackUiMessage(options: {
  fallback: {
    id: string;
    role: string;
  };
  schemaVersion: string;
  raw: unknown;
  reason: string;
}) {
  return {
    id: options.fallback.id,
    role: normalizeStoredMessageRole(undefined, options.fallback.role),
    parts: [
      createUnknownUiMessagePart({
        raw: options.raw,
        schemaVersion: options.schemaVersion,
        reason: options.reason
      })
    ]
  };
}

function normalizeStoredMessageRole(role: unknown, fallbackRole: string) {
  const candidate = typeof role === "string" ? role : fallbackRole;

  switch (candidate) {
    case "system":
    case "user":
    case "assistant":
    case "tool":
      return candidate;
    default:
      return "assistant";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePersistedMessage(message: UIMessage) {
  const idempotencyKey = message.id?.trim() || createPrefixedId("msg");
  const id = hasIdPrefix(idempotencyKey, "msg") ? idempotencyKey : createPrefixedId("msg");

  return {
    id,
    idempotencyKey,
    message: {
      ...message,
      id
    }
  };
}

function hasIdPrefix(value: string, prefix: string) {
  return value.startsWith(`${prefix}_`) && value.length > prefix.length + 1;
}

function createPrefixedId(prefix: string) {
  return `${prefix}_${createCuid2()}`;
}

function hashConfirmationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function serializeToolCallPayload(value: unknown) {
  return JSON.stringify(value ?? null);
}

function serializeToolCallOutput(value: unknown) {
  const serialized = serializeToolCallPayload(value);
  const outputSizeBytes = Buffer.byteLength(serialized, "utf8");

  return {
    value: serialized,
    outputSizeBytes,
    outputTruncated: false
  };
}

function isReasoningModelName(modelName: string) {
  return /^(o1|o3|o4)/i.test(modelName) || /reason/i.test(modelName);
}
