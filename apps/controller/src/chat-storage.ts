import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId as createCuid2 } from "@paralleldrive/cuid2";
import type { UIMessage } from "ai";
import type { ConnectorId } from "./connectors/catalog";
import {
  LIVE_ARTIFACT_LIMITS,
  LIVE_ARTIFACT_SCHEMA_VERSION,
  LiveArtifactCreateInputSchema,
  LiveArtifactCreateTileInputSchema,
  LiveArtifactHtmlDocumentSchema,
  LiveArtifactProvenanceJsonSchema,
  LiveArtifactRenderJsonSchema,
  LiveArtifactSchema,
  LiveArtifactTileSourceSchema,
  LiveArtifactTileSchema,
  LiveArtifactWithTilesSchema,
  type LiveArtifact,
  type LiveArtifactCreateInput,
  type LiveArtifactCreateTileInput,
  type LiveArtifactHtmlDocument,
  type LiveArtifactJsonValue,
  type LiveArtifactTile,
  type LiveArtifactTileSource,
  type LiveArtifactRenderJson,
  type LiveArtifactProvenanceJson,
  type LiveArtifactWithTiles
} from "./live-artifacts/schema";
import { redactSensitiveToolCallText, sanitizeToolCallPersistenceValue } from "./tool-call-redaction";

const DEFAULT_SESSION_TITLE = "New chat";
const CURRENT_UI_MESSAGE_SCHEMA_VERSION = "v1";
const MAX_PERSISTED_TOOL_OUTPUT_BYTES = 8 * 1024;
const ALWAYS_TRUNCATED_PERSISTED_TOOL_NAMES = new Set(["fetch_url", "read_file"]);
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
type PersistedConnectorConnectionStatus = "connected" | "expired" | "disconnected";

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
  readonly message_count?: number;
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

interface LocalAppSettingRow {
  readonly key: string;
  readonly value: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ConnectorProviderComposioSettingsRow {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly authConfigIds: Partial<Record<ConnectorId, string>>;
}

interface ConnectorProviderComposioSettingsStorage {
  readonly key: string;
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly authConfigIds: Partial<Record<ConnectorId, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ConnectorConnectionRow {
  readonly id: string;
  readonly user_id: string;
  readonly connector_id: string;
  readonly provider: string;
  readonly provider_connection_id: string | null;
  readonly provider_metadata_json: string | null;
  readonly account_label: string | null;
  readonly status: PersistedConnectorConnectionStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_connected_at: string | null;
  readonly last_error: string | null;
}

interface ConnectorOAuthStateRow {
  readonly id: string;
  readonly state_hash: string;
  readonly user_id: string;
  readonly connector_id: string;
  readonly provider: string;
  readonly redirect_url: string | null;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly created_at: string;
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
  readonly consumed_tokens: number;
  readonly consumed_tool_calls: number;
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
  readonly connector_id: string | null;
  readonly connector_name: string | null;
  readonly connector_account_label: string | null;
  readonly connector_tool_name: string | null;
  readonly connector_provider_tool_id: string | null;
  readonly connector_arguments_summary: string | null;
  readonly connector_approval_policy_json: string | null;
  readonly connector_provider_execution_id: string | null;
  readonly connector_provider_execution_metadata_json: string | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

interface LiveArtifactRow {
  readonly id: string;
  readonly schema_version: number;
  readonly session_id: string | null;
  readonly created_by_run_id: string | null;
  readonly created_by_tool_call_id: string | null;
  readonly title: string;
  readonly slug: string;
  readonly description: string | null;
  readonly content_type: "html_page_v1";
  readonly current_revision_id: string | null;
  readonly status: "draft" | "active" | "archived";
  readonly pinned: number;
  readonly refresh_status: "idle" | "refreshing" | "failed";
  readonly refresh_started_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_refreshed_at: string | null;
  readonly last_refresh_error: string | null;
}

interface LiveArtifactDocumentRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly revision_id: string;
  readonly format: "html_template_v1";
  readonly sanitized_html: string;
  readonly data_json: string;
  readonly data_schema_json: string | null;
  readonly source_json: string | null;
  readonly sanitizer_version: string;
  readonly created_at: string;
}

interface LiveArtifactTileRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly schema_version: number;
  readonly position: number;
  readonly title: string;
  readonly kind: "markdown" | "metric" | "list" | "table" | "link_card" | "json";
  readonly render_json: string;
  readonly provenance_json: string | null;
  readonly source_json: string | null;
  readonly refresh_status: "idle" | "refreshing" | "failed";
  readonly refresh_started_at: string | null;
  readonly last_refreshed_at: string | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface LiveArtifactRefreshRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly scope: "artifact" | "tile";
  readonly requested_tile_id: string | null;
  readonly status: "running" | "completed" | "partial_failed" | "failed";
  readonly trigger: "manual";
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly error_message: string | null;
}

interface LiveArtifactRefreshStepRow {
  readonly id: string;
  readonly refresh_id: string;
  readonly tile_id: string | null;
  readonly source_type: "tool" | "connector_tool";
  readonly tool_name: string;
  readonly input_json: string;
  readonly connector_id: string | null;
  readonly connector_name: string | null;
  readonly connector_account_label: string | null;
  readonly connector_tool_name: string | null;
  readonly connector_provider_tool_id: string | null;
  readonly connector_arguments_summary: string | null;
  readonly connector_approval_policy_json: string | null;
  readonly approval_basis: string | null;
  readonly connector_provider_execution_id: string | null;
  readonly connector_provider_execution_metadata_json: string | null;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped";
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
  readonly messageCount: number;
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
  readonly consumedTokens: number;
  readonly consumedToolCalls: number;
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

export interface ToolCallConnectorMetadataInput {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly connectorAccountLabel: string | null;
  readonly connectorToolName: string;
  readonly connectorProviderToolId: string;
  readonly connectorArgumentsSummary: string;
  readonly connectorApprovalPolicy: unknown;
}

export interface ToolCallConnectorExecutionMetadataInput {
  readonly providerExecutionId?: string | null;
  readonly providerExecutionMetadata?: Record<string, unknown> | null;
}

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

export interface StoredConnectorConnection {
  readonly id: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly providerConnectionId: string | null;
  readonly providerMetadataJson: string | null;
  readonly accountLabel: string | null;
  readonly status: PersistedConnectorConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastConnectedAt: string | null;
  readonly lastError: string | null;
}

export interface CreateConnectorOAuthStateInput {
  readonly stateHash: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly redirectUrl?: string;
  readonly expiresAt: string;
}

export interface CompleteConnectorOAuthConnectionInput {
  readonly oauthStateId: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly providerConnectionId: string;
  readonly providerMetadataJson: string | null;
  readonly accountLabel: string | null;
  readonly status: PersistedConnectorConnectionStatus;
  readonly lastConnectedAt: string | null;
  readonly lastError: string | null;
}

export interface StoredConnectorOAuthState {
  readonly id: string;
  readonly stateHash: string;
  readonly userId: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly redirectUrl: string | null;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface StoredConnectorProviderComposioSettings {
  readonly key: string;
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly authConfigIds: Partial<Record<ConnectorId, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredPublicConnectorProviderComposioSettings {
  readonly key: string;
  readonly provider: "composio";
  readonly apiKeyConfigured: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly authConfigIds: Partial<Record<ConnectorId, string>>;
  readonly updatedAt: string;
}

export interface ReplaceConnectorProviderComposioSettingsInput {
  readonly apiKey?: string | null | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | null | undefined;
  readonly authConfigIds?: Partial<Record<ConnectorId, string | undefined>> | undefined;
}

export interface CreateProviderInput {
  readonly type: ProviderType;
  readonly displayName: string;
  readonly baseUrl?: string | null | undefined;
  readonly timeoutMs?: number | null | undefined;
}

export interface UpdateProviderInput {
  readonly displayName?: string | undefined;
  readonly baseUrl?: string | null | undefined;
  readonly timeoutMs?: number | null | undefined;
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
  readonly consumedTokens: number;
  readonly consumedToolCalls: number;
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

export interface CreateLiveArtifactInput {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly sessionId?: string | null | undefined;
  readonly contentType?: "html_page_v1" | undefined;
  readonly document?: LiveArtifactCreateInput["document"] | undefined;
  /** @deprecated Legacy tile artifacts are not accepted by the current create schema. */
  readonly tiles?: readonly LiveArtifactCreateTileInput[] | undefined;
  readonly createdByRunId?: string | null | undefined;
  readonly createdByToolCallId?: string | null | undefined;
}

export interface ListLiveArtifactsInput {
  readonly includeArchived?: boolean;
  readonly sessionId?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UpdateLiveArtifactInput {
  readonly title?: string;
  readonly description?: string | null;
}

export interface ReplaceLiveArtifactTilesInput {
  readonly artifactId: string;
  readonly tiles: readonly LiveArtifactCreateTileInput[];
}

export interface ApplyLiveArtifactRefreshResultsInput {
  readonly artifactId: string;
  readonly tiles: readonly {
    readonly tileId: string;
    readonly kind: LiveArtifactTile["kind"];
    readonly renderJson: LiveArtifactRenderJson;
    readonly provenanceJson?: LiveArtifactProvenanceJson | null;
  }[];
  readonly failedTiles?: readonly {
    readonly tileId: string;
    readonly errorMessage: string;
  }[];
}

export interface ApplyLiveArtifactDocumentRefreshResultInput {
  readonly artifactId: string;
  readonly document: LiveArtifactHtmlDocument;
}

export interface StoredLiveArtifactRefresh {
  readonly id: string;
  readonly artifactId: string;
  readonly scope: "artifact" | "tile";
  readonly requestedTileId: string | null;
  readonly status: "running" | "completed" | "partial_failed" | "failed";
  readonly trigger: "manual";
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly errorMessage: string | null;
}

export interface LiveArtifactRefreshStepConnectorMetadataInput {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly connectorAccountLabel: string | null;
  readonly connectorToolName: string;
  readonly connectorProviderToolId: string;
  readonly connectorArgumentsSummary: string;
  readonly connectorApprovalPolicy: unknown;
  readonly approvalBasis: string;
}

export interface StoredLiveArtifactRefreshStep {
  readonly id: string;
  readonly refreshId: string;
  readonly tileId: string | null;
  readonly sourceType: "tool" | "connector_tool";
  readonly toolName: string;
  readonly input: unknown;
  readonly connectorId: string | null;
  readonly connectorName: string | null;
  readonly connectorAccountLabel: string | null;
  readonly connectorToolName: string | null;
  readonly connectorProviderToolId: string | null;
  readonly connectorArgumentsSummary: string | null;
  readonly connectorApprovalPolicy: unknown;
  readonly approvalBasis: string | null;
  readonly connectorProviderExecutionId: string | null;
  readonly connectorProviderExecutionMetadata: unknown;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped";
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface StartLiveArtifactRefreshInput {
  readonly artifactId: string;
  readonly scope: "artifact" | "tile";
  readonly requestedTileId?: string | null;
  readonly tileIdsToRefresh?: readonly string[];
}

export interface StartLiveArtifactRefreshStepInput {
  readonly refreshId: string;
  readonly tileId?: string | null;
  readonly sourceType: "tool" | "connector_tool";
  readonly toolName: string;
  readonly input: unknown;
  readonly connectorMetadata?: LiveArtifactRefreshStepConnectorMetadataInput | null;
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
  getMonetInstallId(): string;
  getConnectorConnection(input: { userId: string; connectorId: string; provider: string }): StoredConnectorConnection | null;
  cancelPendingConnectorApprovals(input: { connectorId: string }): number;
  markConnectorConnectionDisconnected(input: { userId: string; connectorId: string; provider: string }): StoredConnectorConnection | null;
  createConnectorOAuthState(input: CreateConnectorOAuthStateInput): StoredConnectorOAuthState;
  getConnectorOAuthStateByHash(stateHash: string): StoredConnectorOAuthState | null;
  completeConnectorOAuthConnection(input: CompleteConnectorOAuthConnectionInput): StoredConnectorConnection;
  listAuthorizedDirectories(): StoredAuthorizedDirectory[];
  replaceAuthorizedDirectories(paths: readonly string[]): StoredAuthorizedDirectory[];
  getConnectorProviderComposioSettings(): StoredConnectorProviderComposioSettings;
  getConnectorProviderComposioSettingsPublic(): StoredPublicConnectorProviderComposioSettings;
  replaceConnectorProviderComposioSettings(input: ReplaceConnectorProviderComposioSettingsInput): StoredConnectorProviderComposioSettings;
  listSessions(): StoredSession[];
  createSession(input: CreateSessionInput): StoredSession;
  getSessionDetail(sessionId: string): StoredSessionDetail;
  updateSessionTitle(input: { sessionId: string; title: string }): StoredSession;
  archiveSession(sessionId: string): StoredSession;
  deleteSession(sessionId: string): StoredSession;
  createLiveArtifact(input: CreateLiveArtifactInput): LiveArtifactWithTiles;
  listLiveArtifacts(input?: ListLiveArtifactsInput): LiveArtifact[];
  getLiveArtifact(artifactId: string): LiveArtifactWithTiles;
  updateLiveArtifact(artifactId: string, input: UpdateLiveArtifactInput): LiveArtifactWithTiles;
  archiveLiveArtifact(artifactId: string): LiveArtifactWithTiles;
  pinLiveArtifact(artifactId: string, pinned: boolean): LiveArtifactWithTiles;
  replaceLiveArtifactTiles(input: ReplaceLiveArtifactTilesInput): LiveArtifactWithTiles;
  applyLiveArtifactRefreshResults(input: ApplyLiveArtifactRefreshResultsInput): LiveArtifactWithTiles;
  applyLiveArtifactDocumentRefreshResult(input: ApplyLiveArtifactDocumentRefreshResultInput): LiveArtifactWithTiles;
  startLiveArtifactRefresh(input: StartLiveArtifactRefreshInput): StoredLiveArtifactRefresh;
  startLiveArtifactRefreshStep(input: StartLiveArtifactRefreshStepInput): StoredLiveArtifactRefreshStep;
  markLiveArtifactRefreshStepRunning(stepId: string): boolean;
  completeLiveArtifactRefreshStep(options: {
    stepId: string;
    connectorExecutionMetadata?: ToolCallConnectorExecutionMetadataInput;
  }): void;
  failLiveArtifactRefreshStep(options: { stepId: string; errorMessage: string }): void;
  completeLiveArtifactRefresh(options: { refreshId: string; status: "completed" | "partial_failed" | "failed"; errorMessage?: string | null }): void;
  listProviders(): StoredProvider[];
  createProvider(input: CreateProviderInput): StoredProvider;
  updateProvider(providerId: string, input: UpdateProviderInput): StoredProvider;
  deleteProvider(providerId: string): void;
  getProvider(providerId: string): StoredProvider;
  listModels(providerId?: string): StoredProviderModel[];
  createProviderModel(input: {
    providerId: string;
    modelName: string;
    displayName?: string;
    supportsTools?: boolean;
    supportsReasoning?: boolean;
  }): StoredProviderModel;
  getModel(modelId: string): StoredProviderModel;
  updateProviderModel(input: { modelId: string; enabled: boolean }): StoredProviderModel;
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
  interruptActiveRuns(options: { finishReason: string }): RecoverUnfinishedRunsResult;
  startToolCall(options: {
    toolCallId?: string;
    runId: string;
    toolName: string;
    input: unknown;
    metadata?: ToolCallConnectorMetadataInput;
  }): string;
  markToolCallRunning(toolCallId: string): boolean;
  recordToolApprovalRequest(options: { toolCallId: string; confirmationToken: string }): void;
  confirmToolCall(input: ConfirmToolCallInput): ConfirmToolCallResult;
  completeToolCall(options: {
    toolCallId: string;
    output: unknown;
    connectorExecutionMetadata?: ToolCallConnectorExecutionMetadataInput;
  }): {
    outputSizeBytes: number;
    outputTruncated: boolean;
  };
  failToolCall(options: { toolCallId: string; errorMessage: string }): void;
  markRunAwaitingConfirmation(runId: string): void;
  resumeRun(runId: string): boolean;
  updateRunProgress(options: { runId: string; currentStep: number; consumedTokens?: number; consumedToolCalls?: number }): void;
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
  ensureMonetInstallId(connection);
  ensureSqliteFilePermissions(options.databasePath);

  return {
    getMonetInstallId() {
      return getMonetInstallId(connection);
    },

    getConnectorConnection(input) {
      const row = connection
        .prepare(
          `SELECT id, user_id, connector_id, provider, provider_connection_id, provider_metadata_json, account_label,
                  status, created_at, updated_at, last_connected_at, last_error
           FROM connector_connections
           WHERE user_id = ? AND connector_id = ? AND provider = ?
           LIMIT 1`
        )
        .get(input.userId, input.connectorId, input.provider) as ConnectorConnectionRow | undefined;

      return row ? mapConnectorConnectionRow(row) : null;
    },

    cancelPendingConnectorApprovals(input) {
      return cancelPendingConnectorApprovals(connection, input.connectorId, new Date().toISOString());
    },

    markConnectorConnectionDisconnected(input) {
      const now = new Date().toISOString();

      connection
        .prepare(
          `UPDATE connector_connections
           SET provider_connection_id = NULL,
               provider_metadata_json = NULL,
               account_label = NULL,
               status = 'disconnected',
               updated_at = ?,
               last_error = NULL
           WHERE user_id = ? AND connector_id = ? AND provider = ?`
        )
        .run(now, input.userId, input.connectorId, input.provider);

      cancelPendingConnectorApprovals(connection, input.connectorId, now);

      const row = connection
        .prepare(
          `SELECT id, user_id, connector_id, provider, provider_connection_id, provider_metadata_json, account_label,
                  status, created_at, updated_at, last_connected_at, last_error
           FROM connector_connections
           WHERE user_id = ? AND connector_id = ? AND provider = ?
           LIMIT 1`
        )
        .get(input.userId, input.connectorId, input.provider) as ConnectorConnectionRow | undefined;

      return row ? mapConnectorConnectionRow(row) : null;
    },

    createConnectorOAuthState(input) {
      const now = new Date().toISOString();
      const stateId = createPrefixedId("cos");
      const redirectUrl = input.redirectUrl?.trim() || null;

      connection
        .prepare(
          `INSERT INTO connector_oauth_states (id, state_hash, user_id, connector_id, provider, redirect_url, expires_at, consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(stateId, input.stateHash, input.userId, input.connectorId, input.provider, redirectUrl, input.expiresAt, now);

      return {
        id: stateId,
        stateHash: input.stateHash,
        userId: input.userId,
        connectorId: input.connectorId,
        provider: input.provider,
        redirectUrl,
        expiresAt: input.expiresAt,
        consumedAt: null,
        createdAt: now
      };
    },

    getConnectorOAuthStateByHash(stateHash) {
      const row = connection
        .prepare(
          `SELECT id, state_hash, user_id, connector_id, provider, redirect_url, expires_at, consumed_at, created_at
           FROM connector_oauth_states
           WHERE state_hash = ?
           LIMIT 1`
        )
        .get(stateHash) as ConnectorOAuthStateRow | undefined;

      return row ? mapConnectorOAuthStateRow(row) : null;
    },

    completeConnectorOAuthConnection(input) {
      const now = new Date().toISOString();
      const connectionId = createPrefixedId("cco");

      connection.exec("BEGIN IMMEDIATE");

      try {
        const consumedResult = connection
          .prepare(
            `UPDATE connector_oauth_states
             SET consumed_at = ?
             WHERE id = ?
               AND user_id = ?
               AND connector_id = ?
               AND provider = ?
               AND consumed_at IS NULL
               AND expires_at > ?`
          )
          .run(now, input.oauthStateId, input.userId, input.connectorId, input.provider, now) as { changes: number };

        if (consumedResult.changes !== 1) {
          throw new ChatStorageResolutionError({
            message: "Connector OAuth state is invalid, expired, or already consumed.",
            statusCode: 409,
            errorCode: "connector_oauth_state_invalid"
          });
        }

        connection
          .prepare(
            `INSERT INTO connector_connections (
               id, user_id, connector_id, provider, provider_connection_id, provider_metadata_json,
               account_label, status, created_at, updated_at, last_connected_at, last_error
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, connector_id, provider) DO UPDATE SET
               provider_connection_id = excluded.provider_connection_id,
               provider_metadata_json = excluded.provider_metadata_json,
               account_label = excluded.account_label,
               status = excluded.status,
               updated_at = excluded.updated_at,
               last_connected_at = excluded.last_connected_at,
               last_error = excluded.last_error`
          )
          .run(
            connectionId,
            input.userId,
            input.connectorId,
            input.provider,
            input.providerConnectionId,
            input.providerMetadataJson,
            input.accountLabel,
            input.status,
            now,
            now,
            input.lastConnectedAt,
            input.lastError
          );

        const row = connection
          .prepare(
            `SELECT id, user_id, connector_id, provider, provider_connection_id, provider_metadata_json, account_label,
                    status, created_at, updated_at, last_connected_at, last_error
             FROM connector_connections
             WHERE user_id = ? AND connector_id = ? AND provider = ?
             LIMIT 1`
          )
          .get(input.userId, input.connectorId, input.provider) as ConnectorConnectionRow | undefined;

        if (!row) {
          throw new ChatStorageResolutionError({
            message: "Connector connection was not persisted.",
            statusCode: 500,
            errorCode: "connector_connection_not_persisted"
          });
        }

        connection.exec("COMMIT");
        return mapConnectorConnectionRow(row);
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

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

    getConnectorProviderComposioSettings() {
      return getConnectorProviderComposioSettings(connection);
    },

    getConnectorProviderComposioSettingsPublic() {
      const settings = getConnectorProviderComposioSettings(connection);

      return {
        key: settings.key,
        provider: "composio",
        apiKeyConfigured: settings.apiKey !== null,
        baseUrl: settings.baseUrl,
        timeoutMs: settings.timeoutMs,
        authConfigIds: settings.authConfigIds,
        updatedAt: settings.updatedAt
      };
    },

    replaceConnectorProviderComposioSettings(input) {
      const now = new Date().toISOString();
      const existing = getLocalAppSettingRow(connection, COMPOSIO_PROVIDER_SETTINGS_KEY);
      const existingSettings = getConnectorProviderComposioSettings(connection);

      const payload = parseConnectorProviderComposioSettingsInput(input, existingSettings);
      const createdAt = existing?.created_at ?? now;
      const settings: ConnectorProviderComposioSettingsStorage = {
        key: COMPOSIO_PROVIDER_SETTINGS_KEY,
        apiKey: payload.apiKey,
        baseUrl: payload.baseUrl,
        timeoutMs: payload.timeoutMs,
        authConfigIds: payload.authConfigIds,
        createdAt,
        updatedAt: now
      };
      const normalized = normalizeConnectorProviderComposioSettings(settings);

      connection
        .prepare(
          `INSERT INTO local_app_settings ("key", value, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT("key") DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`
        )
        .run(
          normalized.key,
          JSON.stringify(
            toConnectorProviderComposioStoragePayload({
              key: normalized.key,
              apiKey: normalized.apiKey,
              baseUrl: normalized.baseUrl,
              timeoutMs: normalized.timeoutMs,
              authConfigIds: normalized.authConfigIds,
              createdAt: normalized.createdAt,
              updatedAt: normalized.updatedAt
            })
          ),
          normalized.createdAt,
          normalized.updatedAt
        );

      return getConnectorProviderComposioSettings(connection);
    },

    listSessions() {
      const rows = connection
        .prepare(
          `SELECT sessions.id, sessions.title, sessions.created_at, sessions.updated_at, sessions.archived_at,
                  sessions.default_provider_id, sessions.default_model_id, COUNT(messages.id) AS message_count
           FROM sessions
           LEFT JOIN messages ON messages.session_id = sessions.id
           GROUP BY sessions.id
           ORDER BY sessions.archived_at IS NOT NULL ASC, sessions.updated_at DESC, sessions.created_at DESC`
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

    deleteSession(sessionId) {
      const session = getSession(connection, sessionId);

      if (!session) {
        throw new ChatStorageResolutionError({
          message: `Unknown sessionId: ${sessionId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const deletedSession = mapSessionRow(session);

      connection
        .prepare(
          `DELETE FROM sessions
           WHERE id = ?`
        )
        .run(sessionId);

      return deletedSession;
    },

    createLiveArtifact(input) {
      const { createdByRunId, createdByToolCallId, ...artifactInput } = input;
      const parsed = LiveArtifactCreateInputSchema.parse(artifactInput);
      const artifactId = createPrefixedId("art");
      const now = new Date().toISOString();
      const inferredSourceJson = parsed.document.sourceJson
        ? null
        : inferRefreshSourceFromRecentConnectorToolCall(connection, {
          runId: createdByRunId ?? null,
          beforeToolCallId: createdByToolCallId ?? null
        });
      const sourceJson = parsed.document.sourceJson ?? inferredSourceJson;
      const document = sourceJson ? { ...parsed.document, sourceJson } : parsed.document;
      const shouldUseInferredSource = !parsed.document.sourceJson && sourceJson
        ? LiveArtifactCreateInputSchema.safeParse({ ...parsed, document }).success
        : true;
      const validatedDocument = shouldUseInferredSource ? document : parsed.document;
      const reparsed = LiveArtifactCreateInputSchema.parse({ ...parsed, document: validatedDocument });

      connection.exec("BEGIN IMMEDIATE");

      try {
        const slug = createUniqueLiveArtifactSlug(connection, reparsed.title, artifactId);
        const currentRevisionId = createPrefixedId("rev");

        connection
          .prepare(
            `INSERT INTO live_artifacts (
               id, schema_version, session_id, created_by_run_id, created_by_tool_call_id,
               title, slug, description, content_type, current_revision_id, status, pinned, refresh_status, refresh_started_at,
               created_at, updated_at, last_refreshed_at, last_refresh_error
              )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 'idle', NULL, ?, ?, NULL, NULL)`
          )
          .run(
            artifactId,
            LIVE_ARTIFACT_SCHEMA_VERSION,
            reparsed.sessionId ?? null,
            createdByRunId?.trim() || null,
            createdByToolCallId?.trim() || null,
            reparsed.title,
            slug,
            reparsed.description ?? null,
            reparsed.contentType,
            currentRevisionId,
            now,
            now
          );

        insertLiveArtifactDocument(connection, artifactId, currentRevisionId, reparsed.document, now);

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return getLiveArtifactOrThrow(connection, artifactId);
    },

    listLiveArtifacts(input = {}) {
      const includeArchived = input.includeArchived === true;
      const sessionId = input.sessionId === undefined ? undefined : input.sessionId;
      const limit = clampLiveArtifactListLimit(input.limit);
      const offset = Math.max(0, Math.trunc(input.offset ?? 0));
      const whereClauses: string[] = [];
      const params: Array<string | number> = [];

      whereClauses.push("content_type = 'html_page_v1'");

      if (!includeArchived) {
        whereClauses.push("status != 'archived'");
      }

      if (sessionId !== undefined) {
        if (sessionId === null) {
          whereClauses.push("session_id IS NULL");
        } else {
          whereClauses.push("session_id = ?");
          params.push(sessionId);
        }
      }

      params.push(limit, offset);

      const rows = connection
        .prepare(
          `SELECT id, schema_version, session_id, created_by_run_id, created_by_tool_call_id,
                  title, slug, description, content_type, current_revision_id, status, pinned, refresh_status, refresh_started_at,
                  created_at, updated_at, last_refreshed_at, last_refresh_error
           FROM live_artifacts
           ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
           ORDER BY pinned DESC, updated_at DESC, created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params) as unknown as LiveArtifactRow[];

      return rows.map(mapLiveArtifactRow);
    },

    getLiveArtifact(artifactId) {
      return getLiveArtifactOrThrow(connection, artifactId);
    },

    updateLiveArtifact(artifactId, input) {
      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        const patch = parseLiveArtifactUpdateInput(input, existing);
        const now = new Date().toISOString();

        connection
          .prepare(
            `UPDATE live_artifacts
             SET title = ?, description = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(patch.title, patch.description, now, artifactId);

        const artifact = getLiveArtifactOrThrow(connection, artifactId);
        connection.exec("COMMIT");
        return artifact;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    archiveLiveArtifact(artifactId) {
      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        const now = new Date().toISOString();

        connection
          .prepare(
            `UPDATE live_artifacts
             SET status = 'archived', pinned = 0, refresh_status = 'idle', refresh_started_at = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(now, artifactId);

        const artifact = getLiveArtifactOrThrow(connection, artifactId);
        connection.exec("COMMIT");
        return artifact;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    pinLiveArtifact(artifactId, pinned) {
      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        if (existing.status === "archived" && pinned) {
          throw new ChatStorageResolutionError({
            message: "Archived artifacts cannot be pinned.",
            statusCode: 409,
            errorCode: "invalid_state"
          });
        }

        const now = new Date().toISOString();

        connection
          .prepare(
            `UPDATE live_artifacts
             SET pinned = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(pinned ? 1 : 0, now, artifactId);

        const artifact = getLiveArtifactOrThrow(connection, artifactId);
        connection.exec("COMMIT");
        return artifact;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    replaceLiveArtifactTiles(input) {
      const tiles = input.tiles.map((tile) => LiveArtifactCreateTileInputSchema.parse(tile));
      if (tiles.length === 0 || tiles.length > 50) {
        throw new ChatStorageResolutionError({
          message: "Live artifact tile replacement requires between 1 and 50 tiles.",
          errorCode: "invalid_request"
        });
      }
      const now = new Date().toISOString();

      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, input.artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${input.artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        connection.prepare("DELETE FROM live_artifact_tiles WHERE artifact_id = ?").run(input.artifactId);
        insertLiveArtifactTiles(connection, input.artifactId, tiles, now);
        connection.prepare("UPDATE live_artifacts SET updated_at = ? WHERE id = ?").run(now, input.artifactId);
        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return getLiveArtifactOrThrow(connection, input.artifactId);
    },

    applyLiveArtifactRefreshResults(input) {
      const now = new Date().toISOString();

      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, input.artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${input.artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        const updateTile = connection.prepare(
          `UPDATE live_artifact_tiles
           SET kind = ?, render_json = ?, provenance_json = ?, refresh_status = 'idle',
                refresh_started_at = NULL, last_refreshed_at = ?, last_error = NULL, updated_at = ?
            WHERE id = ? AND artifact_id = ?`
        );
        const failTile = connection.prepare(
          `UPDATE live_artifact_tiles
           SET refresh_status = 'failed', refresh_started_at = NULL, last_error = ?, updated_at = ?
           WHERE id = ? AND artifact_id = ?`
        );

        for (const tile of input.tiles) {
          const parsedRenderJson = LiveArtifactRenderJsonSchema.parse(tile.renderJson);
          const parsedProvenanceJson = tile.provenanceJson == null
            ? null
            : LiveArtifactProvenanceJsonSchema.parse(tile.provenanceJson);

          if (tile.kind !== parsedRenderJson.kind) {
            throw new ChatStorageResolutionError({
              message: "Refreshed tile kind must match render JSON kind.",
              errorCode: "invalid_request"
            });
          }

          const result = updateTile.run(
            tile.kind,
            JSON.stringify(parsedRenderJson),
            parsedProvenanceJson == null ? null : JSON.stringify(parsedProvenanceJson),
            now,
            now,
            tile.tileId,
            input.artifactId
          );

          if (result.changes !== 1) {
            throw new ChatStorageResolutionError({
              message: `Unknown tileId for artifact: ${tile.tileId}`,
              statusCode: 404,
              errorCode: "not_found"
            });
          }
        }

        for (const failedTile of input.failedTiles ?? []) {
          const result = failTile.run(
            truncateLiveArtifactError(failedTile.errorMessage),
            now,
            failedTile.tileId,
            input.artifactId
          );

          if (result.changes !== 1) {
            throw new ChatStorageResolutionError({
              message: `Unknown tileId for artifact: ${failedTile.tileId}`,
              statusCode: 404,
              errorCode: "not_found"
            });
          }
        }

        const failedCount = input.failedTiles?.length ?? 0;
        connection
          .prepare(
            `UPDATE live_artifacts
             SET refresh_status = ?, refresh_started_at = NULL, last_refreshed_at = ?,
                  last_refresh_error = ?, updated_at = ?
              WHERE id = ?`
          )
          .run(failedCount > 0 ? "failed" : "idle", now, null, now, input.artifactId);

        const artifact = getLiveArtifactOrThrow(connection, input.artifactId);
        connection.exec("COMMIT");
        return artifact;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    applyLiveArtifactDocumentRefreshResult(input) {
      const parsedDocument = LiveArtifactHtmlDocumentSchema.parse(input.document);
      const now = new Date().toISOString();
      const revisionId = createPrefixedId("rev");

      connection.exec("BEGIN IMMEDIATE");

      try {
        const existing = getLiveArtifactRow(connection, input.artifactId);

        if (!existing) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${input.artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        if (existing.content_type !== "html_page_v1") {
          throw new ChatStorageResolutionError({
            message: "Document refresh results can only be applied to HTML page artifacts.",
            errorCode: "invalid_request"
          });
        }

        insertLiveArtifactDocument(connection, input.artifactId, revisionId, parsedDocument, now);
        connection
          .prepare(
            `UPDATE live_artifacts
             SET current_revision_id = ?, refresh_status = 'idle', refresh_started_at = NULL,
                 last_refreshed_at = ?, last_refresh_error = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(revisionId, now, now, input.artifactId);

        const artifact = getLiveArtifactOrThrow(connection, input.artifactId);
        connection.exec("COMMIT");
        return artifact;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    startLiveArtifactRefresh(input) {
      connection.exec("BEGIN IMMEDIATE");

      try {
        const artifact = getLiveArtifactRow(connection, input.artifactId);

        if (!artifact) {
          throw new ChatStorageResolutionError({
            message: `Unknown artifactId: ${input.artifactId}`,
            statusCode: 404,
            errorCode: "not_found"
          });
        }

        if (artifact.refresh_status === "refreshing" || hasRunningLiveArtifactRefresh(connection, input.artifactId)) {
          throw new ChatStorageResolutionError({
            message: "Live artifact refresh is already in progress.",
            statusCode: 409,
            errorCode: "refresh_in_progress"
          });
        }

        const requestedTileId = input.requestedTileId?.trim() || null;
        const tileIdsToRefresh = [...new Set((input.tileIdsToRefresh ?? []).map((tileId) => tileId.trim()).filter(Boolean))];

        if (input.scope === "tile") {
          if (!requestedTileId) {
            throw new ChatStorageResolutionError({
              message: "Tile refresh audit records require requestedTileId.",
              errorCode: "invalid_request"
            });
          }

          const tile = assertLiveArtifactTileBelongsToArtifact(connection, input.artifactId, requestedTileId);
          if (tile.refresh_status === "refreshing") {
            throw new ChatStorageResolutionError({
              message: "Live artifact tile refresh is already in progress.",
              statusCode: 409,
              errorCode: "refresh_in_progress"
            });
          }
        } else if (requestedTileId !== null) {
          throw new ChatStorageResolutionError({
            message: "Whole-artifact refresh audit records cannot include requestedTileId.",
            errorCode: "invalid_request"
          });
        }

        for (const tileId of tileIdsToRefresh) {
          const tile = assertLiveArtifactTileBelongsToArtifact(connection, input.artifactId, tileId);
          if (tile.refresh_status === "refreshing") {
            throw new ChatStorageResolutionError({
              message: "Live artifact tile refresh is already in progress.",
              statusCode: 409,
              errorCode: "refresh_in_progress"
            });
          }
        }

        const refreshId = createPrefixedId("lar");
        const now = new Date().toISOString();

        connection
          .prepare(
            `INSERT INTO live_artifact_refreshes (id, artifact_id, scope, requested_tile_id, status, trigger, started_at, ended_at, error_message)
             VALUES (?, ?, ?, ?, 'running', 'manual', ?, NULL, NULL)`
          )
          .run(refreshId, input.artifactId, input.scope, requestedTileId, now);

        connection
          .prepare(
            `UPDATE live_artifacts
             SET refresh_status = 'refreshing', refresh_started_at = ?, last_refresh_error = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(now, now, input.artifactId);

        const tileIdsToMark = input.scope === "tile" && requestedTileId ? [requestedTileId] : tileIdsToRefresh;
        const markTileRefreshing = connection.prepare(
          `UPDATE live_artifact_tiles
           SET refresh_status = 'refreshing', refresh_started_at = ?, last_error = NULL, updated_at = ?
           WHERE id = ? AND artifact_id = ?`
        );

        for (const tileId of tileIdsToMark) {
          markTileRefreshing.run(now, now, tileId, input.artifactId);
        }

        const refresh = getLiveArtifactRefreshOrThrow(connection, refreshId);
        connection.exec("COMMIT");
        return refresh;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },

    startLiveArtifactRefreshStep(input) {
      const refresh = getLiveArtifactRefreshRow(connection, input.refreshId);

      if (!refresh) {
        throw new ChatStorageResolutionError({
          message: `Unknown live artifact refreshId: ${input.refreshId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      if (refresh.status !== "running") {
        throw new ChatStorageResolutionError({
          message: "Live artifact refresh steps can only be created for running refreshes.",
          statusCode: 409,
          errorCode: "invalid_state"
        });
      }

      const tileId = input.tileId?.trim() || null;
      const toolName = input.toolName.trim();

      if (!toolName) {
        throw new ChatStorageResolutionError({
          message: "Live artifact refresh steps require toolName.",
          errorCode: "invalid_request"
        });
      }

      if (tileId !== null) {
        assertLiveArtifactTileBelongsToArtifact(connection, refresh.artifact_id, tileId);
      }

      if (input.sourceType === "connector_tool" && !hasCompleteLiveArtifactRefreshConnectorMetadata(input.connectorMetadata)) {
        throw new ChatStorageResolutionError({
          message: "Connector refresh steps require connector audit metadata before execution.",
          errorCode: "audit_required"
        });
      }

      if (input.sourceType === "tool" && input.connectorMetadata) {
        throw new ChatStorageResolutionError({
          message: "Non-connector refresh steps cannot include connector audit metadata.",
          errorCode: "invalid_request"
        });
      }

      const stepId = createPrefixedId("lrs");
      const now = new Date().toISOString();
      const metadata = input.connectorMetadata ?? null;

      connection
        .prepare(
          `INSERT INTO live_artifact_refresh_steps (
             id, refresh_id, tile_id, source_type, tool_name, input_json,
             connector_id, connector_name, connector_account_label, connector_tool_name,
             connector_provider_tool_id, connector_arguments_summary, connector_approval_policy_json,
             approval_basis, connector_provider_execution_id, connector_provider_execution_metadata_json,
             status, error_message, started_at, ended_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', NULL, ?, NULL)`
        )
        .run(
          stepId,
          input.refreshId,
          tileId,
          input.sourceType,
          toolName,
          serializeToolCallPayload(input.input),
          metadata?.connectorId ?? null,
          metadata?.connectorName ?? null,
          metadata?.connectorAccountLabel ?? null,
          metadata?.connectorToolName ?? null,
          metadata?.connectorProviderToolId ?? null,
          metadata?.connectorArgumentsSummary ? redactSensitiveToolCallText(metadata.connectorArgumentsSummary) : null,
          metadata ? serializeToolCallPayload(metadata.connectorApprovalPolicy) : null,
          metadata?.approvalBasis ?? null,
          now
        );

      return getLiveArtifactRefreshStepOrThrow(connection, stepId);
    },

    markLiveArtifactRefreshStepRunning(stepId) {
      connection
        .prepare(
          `UPDATE live_artifact_refresh_steps
           SET status = 'running', error_message = NULL, ended_at = NULL
           WHERE id = ? AND status = 'pending'`
        )
        .run(stepId);

      const row = getLiveArtifactRefreshStepRow(connection, stepId);
      return row?.status === "running";
    },

    completeLiveArtifactRefreshStep({ stepId, connectorExecutionMetadata }) {
      const endedAt = new Date().toISOString();
      const providerExecutionMetadataJson = connectorExecutionMetadata?.providerExecutionMetadata
        ? serializeToolCallPayload(connectorExecutionMetadata.providerExecutionMetadata)
        : null;

      connection
        .prepare(
          `UPDATE live_artifact_refresh_steps
           SET status = 'completed',
               connector_provider_execution_id = COALESCE(?, connector_provider_execution_id),
               connector_provider_execution_metadata_json = COALESCE(?, connector_provider_execution_metadata_json),
               error_message = NULL,
               ended_at = ?
           WHERE id = ?`
        )
        .run(
          connectorExecutionMetadata?.providerExecutionId?.trim() || null,
          providerExecutionMetadataJson,
          endedAt,
          stepId
        );
    },

    failLiveArtifactRefreshStep({ stepId, errorMessage }) {
      const endedAt = new Date().toISOString();

      connection
        .prepare(
          `UPDATE live_artifact_refresh_steps
           SET status = 'failed', error_message = ?, ended_at = ?
           WHERE id = ?`
        )
        .run(truncateLiveArtifactError(errorMessage), endedAt, stepId);
    },

    completeLiveArtifactRefresh({ refreshId, status, errorMessage }) {
      const endedAt = new Date().toISOString();
      const refresh = getLiveArtifactRefreshRow(connection, refreshId);

      if (!refresh) {
        throw new ChatStorageResolutionError({
          message: `Unknown live artifact refreshId: ${refreshId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const truncatedError = errorMessage ? truncateLiveArtifactError(errorMessage) : null;

      connection
        .prepare(
          `UPDATE live_artifact_refreshes
           SET status = ?, error_message = ?, ended_at = ?
           WHERE id = ?`
        )
        .run(status, truncatedError, endedAt, refreshId);

      connection
        .prepare(
          `UPDATE live_artifacts
           SET refresh_status = ?, refresh_started_at = NULL,
               last_refreshed_at = CASE WHEN ? = 'completed' THEN ? ELSE last_refreshed_at END,
               last_refresh_error = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(status === "completed" ? "idle" : "failed", status, endedAt, truncatedError, endedAt, refresh.artifact_id);

      connection
        .prepare(
          `UPDATE live_artifact_tiles
            SET refresh_status = ?, refresh_started_at = NULL,
                last_refreshed_at = CASE WHEN ? = 'completed' THEN ? ELSE last_refreshed_at END,
                last_error = CASE WHEN ? = 'completed' THEN NULL ELSE COALESCE(last_error, ?) END,
                updated_at = ?
            WHERE artifact_id = ? AND refresh_status = 'refreshing'`
        )
        .run(status === "completed" ? "idle" : "failed", status, endedAt, status, truncatedError, endedAt, refresh.artifact_id);
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

    createProvider(input) {
      const now = new Date().toISOString();
      const id = createPrefixedId("pro");

      connection
        .prepare(
          `INSERT INTO providers (id, type, display_name, base_url, timeout_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.type, input.displayName, input.baseUrl ?? null, input.timeoutMs ?? null, now, now);

      return this.getProvider(id);
    },

    updateProvider(providerId, input) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();

      connection
        .prepare(
          `UPDATE providers
           SET display_name = ?, base_url = ?, timeout_ms = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.displayName ?? provider.display_name,
          input.baseUrl === undefined ? provider.base_url : input.baseUrl,
          input.timeoutMs === undefined ? provider.timeout_ms : input.timeoutMs,
          now,
          providerId
        );

      return this.getProvider(providerId);
    },

    deleteProvider(providerId) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const providerHasRuns = connection
        .prepare(
          `SELECT 1 AS exists_flag
           FROM runs
           WHERE provider_id = ?
              OR model_id IN (SELECT id FROM provider_models WHERE provider_id = ?)
           LIMIT 1`
        )
        .get(providerId, providerId) as { exists_flag: number } | undefined;

      if (providerHasRuns) {
        throw new ChatStorageResolutionError({
          message: "Provider cannot be deleted because it has associated runs.",
          statusCode: 409,
          errorCode: "invalid_state"
        });
      }

      try {
        connection.exec("BEGIN");
        connection.prepare(`DELETE FROM provider_models WHERE provider_id = ?`).run(providerId);
        connection.prepare(`DELETE FROM providers WHERE id = ?`).run(providerId);
        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
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

    createProviderModel({ providerId, modelName, displayName, supportsTools, supportsReasoning }) {
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const normalizedModelName = modelName.trim();

      if (!normalizedModelName) {
        throw new ChatStorageResolutionError({
          message: "Model name is required.",
          statusCode: 422,
          errorCode: "invalid_request"
        });
      }

      const existingModel = getProviderModelByProviderAndName(connection, providerId, normalizedModelName);
      const now = new Date().toISOString();
      const inferredSupportsReasoning = /^(o1|o3|o4)/i.test(normalizedModelName) || /reason/i.test(normalizedModelName);

      if (existingModel) {
        connection
          .prepare(
            `UPDATE provider_models
             SET display_name = ?, supports_tools = ?, supports_reasoning = ?, enabled = 1, updated_at = ?
             WHERE id = ?`
          )
          .run(
            displayName?.trim() || existingModel.display_name || normalizedModelName,
            (supportsTools ?? Boolean(existingModel.supports_tools)) ? 1 : 0,
            (supportsReasoning ?? Boolean(existingModel.supports_reasoning)) ? 1 : 0,
            now,
            existingModel.id
          );

        connection
          .prepare(
            `UPDATE providers
             SET default_model_name = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(normalizedModelName, now, providerId);

        return this.getModel(existingModel.id);
      }

      const modelId = createPrefixedId("mod");

      connection.exec("BEGIN");

      try {
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
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
          )
          .run(
            modelId,
            providerId,
            normalizedModelName,
            displayName?.trim() || normalizedModelName,
            (supportsTools ?? true) ? 1 : 0,
            (supportsReasoning ?? inferredSupportsReasoning) ? 1 : 0,
            JSON.stringify({ source: "manual" }),
            now,
            now
          );

        connection
          .prepare(
            `UPDATE providers
             SET default_model_name = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(normalizedModelName, now, providerId);

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return this.getModel(modelId);
    },

    updateProviderModel({ modelId, enabled }) {
      const model = getProviderModelById(connection, modelId);

      if (!model) {
        throw new ChatStorageResolutionError({
          message: `Unknown modelId: ${modelId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();

      connection.exec("BEGIN");

      try {

        if (enabled) {
          const providerModels = connection
            .prepare(
              `SELECT id, enabled
               FROM provider_models
               WHERE provider_id = ?`
            )
            .all(model.provider_id) as unknown as Array<{ id: string; enabled: number }>;
          const catalogLooksAutoEnabled = providerModels.length > 1 && providerModels.every((providerModel) => providerModel.enabled === 1);

          if (catalogLooksAutoEnabled) {
            connection
              .prepare(
                `UPDATE provider_models
                 SET enabled = 0, updated_at = ?
                 WHERE provider_id = ?`
              )
              .run(now, model.provider_id);
          }
        }

        connection
          .prepare(
            `UPDATE provider_models
             SET enabled = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(enabled ? 1 : 0, now, modelId);

        if (enabled) {
          connection
            .prepare(
              `UPDATE providers
               SET default_model_name = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(model.model_name, now, model.provider_id);
        } else {
          const provider = getProviderById(connection, model.provider_id);

          if (provider?.default_model_name === model.model_name) {
            const nextDefaultModel = connection
              .prepare(
                `SELECT model_name
                 FROM provider_models
                 WHERE provider_id = ? AND enabled = 1
                 ORDER BY display_name ASC, created_at ASC
                 LIMIT 1`
              )
              .get(model.provider_id) as { model_name: string } | undefined;

            connection
              .prepare(
                `UPDATE providers
                 SET default_model_name = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(nextDefaultModel?.model_name ?? null, now, model.provider_id);
          }
        }

        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }

      return this.getModel(modelId);
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
      let resolvedProvider = provider;
      let defaultModel = provider.default_model_name
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

      if (!defaultModel) {
        defaultModel = models[0] ?? null;

        if (!defaultModel) {
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

        connection
          .prepare(
            `UPDATE providers
             SET default_model_name = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(defaultModel.model_name, new Date().toISOString(), providerId);
        resolvedProvider = getProviderById(connection, providerId) ?? provider;
      }

      return {
        provider: mapProviderRow(resolvedProvider),
        valid: true,
        reason: "ok",
        message: "Provider configuration is valid.",
        defaultModelId: defaultModel.id,
        defaultModelName: defaultModel.model_name,
        availableModelCount: models.length
      };
    },

    replaceProviderCatalog(input) {
      const { providerId, defaultModelName, models } = input;
      const hasExplicitDefaultModelName = Object.prototype.hasOwnProperty.call(input, "defaultModelName");
      const provider = getProviderById(connection, providerId);

      if (!provider) {
        throw new ChatStorageResolutionError({
          message: `Unknown providerId: ${providerId}`,
          statusCode: 404,
          errorCode: "not_found"
        });
      }

      const now = new Date().toISOString();
      const incomingModelNames = new Set(models.map((model) => model.modelName));
      const existingModels = connection
        .prepare(
          `SELECT id, model_name, enabled
           FROM provider_models
           WHERE provider_id = ?`
        )
        .all(providerId) as Array<{ id: string; model_name: string; enabled: number }>;
      const staleModels = existingModels.filter((model) => !incomingModelNames.has(model.model_name));

      const firstIncomingModelName = models[0]?.modelName ?? null;
      let nextDefaultModelName: string | null;

      if (hasExplicitDefaultModelName && defaultModelName === null) {
        nextDefaultModelName = null;
      } else if (defaultModelName && incomingModelNames.has(defaultModelName)) {
        nextDefaultModelName = defaultModelName;
      } else if (provider.default_model_name && incomingModelNames.has(provider.default_model_name)) {
        nextDefaultModelName = provider.default_model_name;
      } else {
        nextDefaultModelName = firstIncomingModelName;
      }

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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, model_name) DO UPDATE SET
          display_name = excluded.display_name,
          supports_tools = excluded.supports_tools,
          supports_reasoning = excluded.supports_reasoning,
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
          .run(nextDefaultModelName, now, providerId);

        for (const model of models) {
          const existingModel = getProviderModelByProviderAndName(connection, providerId, model.modelName);

          upsertModelStatement.run(
            existingModel?.id ?? createPrefixedId("mod"),
            providerId,
            model.modelName,
            model.displayName,
            model.supportsTools ? 1 : 0,
            model.supportsReasoning ? 1 : 0,
            existingModel?.enabled ?? 0,
            model.capabilitiesJson,
            existingModel?.created_at ?? now,
            now
          );
        }

        if (staleModels.length > 0) {
          const hasRunReferenceStatement = connection.prepare(
            `SELECT 1 AS exists_flag
             FROM runs
             WHERE model_id = ?
             LIMIT 1`
          );
          const disableProviderModelStatement = connection.prepare(
            `UPDATE provider_models
             SET enabled = 0, updated_at = ?
             WHERE id = ?`
          );
          const deleteProviderModelStatement = connection.prepare(`DELETE FROM provider_models WHERE id = ?`);

          for (const model of staleModels) {
            const hasRunReference = hasRunReferenceStatement.get(model.id) as { exists_flag: number } | undefined;

            if (hasRunReference) {
              if (model.enabled === 1) {
                disableProviderModelStatement.run(now, model.id);
              }

              continue;
            }

            deleteProviderModelStatement.run(model.id);
          }
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

      if (session?.archived_at) {
        throw new ChatStorageResolutionError({
          message: `Session is archived: ${sessionId}`,
          statusCode: 422,
          errorCode: "invalid_state"
        });
      }

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
        consumedTokens: 0,
        consumedToolCalls: 0,
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

    interruptActiveRuns({ finishReason }) {
      const interruptedRunIds = listRunIdsByStatus(connection, "running");
      const endedAt = new Date().toISOString();

      if (interruptedRunIds.length > 0) {
        connection
          .prepare(
            `UPDATE runs
             SET status = 'interrupted', finish_reason = ?, ended_at = ?
             WHERE status = 'running'`
          )
          .run(finishReason, endedAt);
      }

      return {
        interruptedRunIds,
        failedRunIds: []
      };
    },

    startToolCall({ toolCallId, runId, toolName, input, metadata }) {
      const startedAt = new Date().toISOString();
      const persistedToolCallId = toolCallId?.trim() || createPrefixedId("tcl");
      const connectorApprovalPolicyJson = metadata ? serializeToolCallPayload(metadata.connectorApprovalPolicy) : null;

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
             connector_id,
             connector_name,
             connector_account_label,
             connector_tool_name,
             connector_provider_tool_id,
             connector_arguments_summary,
             connector_approval_policy_json,
             connector_provider_execution_id,
             connector_provider_execution_metadata_json,
             status,
             error_message,
             started_at,
             ended_at
           ) VALUES (?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', NULL, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
              run_id = excluded.run_id,
              tool_name = excluded.tool_name,
              input_json = excluded.input_json,
              connector_id = excluded.connector_id,
              connector_name = excluded.connector_name,
              connector_account_label = excluded.connector_account_label,
              connector_tool_name = excluded.connector_tool_name,
              connector_provider_tool_id = excluded.connector_provider_tool_id,
              connector_arguments_summary = excluded.connector_arguments_summary,
              connector_approval_policy_json = excluded.connector_approval_policy_json,
              connector_provider_execution_id = NULL,
              connector_provider_execution_metadata_json = NULL`
        )
        .run(
          persistedToolCallId,
          runId,
          toolName,
          serializeToolCallPayload(input),
          metadata?.connectorId ?? null,
          metadata?.connectorName ?? null,
          metadata?.connectorAccountLabel ?? null,
          metadata?.connectorToolName ?? null,
          metadata?.connectorProviderToolId ?? null,
          metadata?.connectorArgumentsSummary ?? null,
          connectorApprovalPolicyJson,
          startedAt
        );

      return persistedToolCallId;
    },

    markToolCallRunning(toolCallId) {
      connection
        .prepare(
          `UPDATE tool_calls
           SET status = 'running',
               error_message = NULL,
               ended_at = NULL
           WHERE id = ?
             AND status != 'completed'
             AND NOT (status = 'failed' AND approval_decision = 'rejected')`
        )
        .run(toolCallId);

      const row = getToolCallRow(connection, toolCallId);
      return !(row?.status === "failed" && row.approval_decision === "rejected");
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

    completeToolCall({ toolCallId, output, connectorExecutionMetadata }) {
      const endedAt = new Date().toISOString();
      const serializedOutput = serializeToolCallOutput(output);
      const providerExecutionMetadataJson = connectorExecutionMetadata?.providerExecutionMetadata
        ? serializeToolCallPayload(connectorExecutionMetadata.providerExecutionMetadata)
        : null;

      connection
        .prepare(
          `UPDATE tool_calls
           SET status = 'completed',
               output_json = ?,
               output_truncated = ?,
               output_size_bytes = ?,
               connector_provider_execution_id = COALESCE(?, connector_provider_execution_id),
               connector_provider_execution_metadata_json = COALESCE(?, connector_provider_execution_metadata_json),
               error_message = NULL,
               ended_at = ?
            WHERE id = ?`
        )
        .run(
          serializedOutput.value,
          serializedOutput.outputTruncated ? 1 : 0,
          serializedOutput.outputSizeBytes,
          connectorExecutionMetadata?.providerExecutionId?.trim() || null,
          providerExecutionMetadataJson,
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
      const resumedRun = connection
        .prepare(
          `UPDATE runs
           SET status = 'running', finish_reason = NULL, ended_at = NULL
           WHERE id = ? AND status = 'pending'`
        )
        .run(runId);

      return resumedRun.changes > 0;
    },

    updateRunProgress({ runId, currentStep, consumedTokens, consumedToolCalls }) {
      const normalizedCurrentStep = Math.max(0, currentStep);
      const normalizedConsumedTokens = Math.max(0, consumedTokens ?? 0);
      const normalizedConsumedToolCalls = Math.max(0, consumedToolCalls ?? 0);

      connection
        .prepare(
          `UPDATE runs
           SET current_step = CASE
             WHEN current_step > ? THEN current_step
             ELSE ?
           END,
           consumed_tokens = CASE
             WHEN consumed_tokens > ? THEN consumed_tokens
             ELSE ?
           END,
           consumed_tool_calls = CASE
             WHEN consumed_tool_calls > ? THEN consumed_tool_calls
             ELSE ?
           END
           WHERE id = ?`
        )
        .run(
          normalizedCurrentStep,
          normalizedCurrentStep,
          normalizedConsumedTokens,
          normalizedConsumedTokens,
          normalizedConsumedToolCalls,
          normalizedConsumedToolCalls,
          runId
        );
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
      `SELECT id, session_id, status, provider_id, model_id, current_step, consumed_tokens, consumed_tool_calls, max_steps, max_tokens_per_run, wall_clock_deadline_at, finish_reason, started_at, ended_at
       FROM runs
       WHERE id = ?
       LIMIT 1`
    )
    .get(runId) as RunRow | undefined;
}

function getToolCallRow(connection: DatabaseSync, toolCallId: string) {
  return connection
    .prepare(
      `SELECT id, run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, approval_decision, approval_decided_at, confirmation_token_hash, connector_id, connector_name, connector_account_label, connector_tool_name, connector_provider_tool_id, connector_arguments_summary, connector_approval_policy_json, connector_provider_execution_id, connector_provider_execution_metadata_json, status, error_message, started_at, ended_at
       FROM tool_calls
       WHERE id = ?
       LIMIT 1`
    )
    .get(toolCallId) as ToolCallRow | undefined;
}

function cancelPendingConnectorApprovals(connection: DatabaseSync, connectorId: string, now: string): number {
  const affectedRunIds = (
    connection
      .prepare(
        `SELECT DISTINCT run_id
         FROM tool_calls
         WHERE connector_id = ?
           AND confirmation_token_hash IS NOT NULL
           AND approval_decision IS NULL
           AND status = 'pending'`
      )
      .all(connectorId) as Array<{ run_id: string }>
  ).map((row) => row.run_id);

  const result = connection
    .prepare(
      `UPDATE tool_calls
       SET approval_decision = 'rejected',
           approval_decided_at = COALESCE(approval_decided_at, ?),
           confirmation_token_hash = NULL,
           status = 'failed',
           error_message = 'Connector disconnected before tool approval was confirmed.',
           ended_at = COALESCE(ended_at, ?)
       WHERE connector_id = ?
         AND confirmation_token_hash IS NOT NULL
         AND approval_decision IS NULL
         AND status = 'pending'`
    )
    .run(now, now, connectorId);

  if (affectedRunIds.length > 0 && result.changes > 0) {
    const placeholders = affectedRunIds.map(() => "?").join(", ");
    connection
      .prepare(
        `UPDATE runs
         SET status = 'interrupted', finish_reason = 'connector_disconnected', ended_at = ?
         WHERE status = 'pending'
           AND id IN (${placeholders})`
      )
      .run(now, ...affectedRunIds);
  }

  return Number(result.changes);
}

const LIVE_ARTIFACT_LIST_LIMIT_DEFAULT = 100;
const LIVE_ARTIFACT_LIST_LIMIT_MAX = 500;

function getLiveArtifactRow(connection: DatabaseSync, artifactId: string) {
  return connection
    .prepare(
      `SELECT id, schema_version, session_id, created_by_run_id, created_by_tool_call_id,
              title, slug, description, content_type, current_revision_id, status, pinned, refresh_status, refresh_started_at,
              created_at, updated_at, last_refreshed_at, last_refresh_error
       FROM live_artifacts
       WHERE id = ?
       LIMIT 1`
    )
    .get(artifactId) as LiveArtifactRow | undefined;
}

function getLiveArtifactOrThrow(connection: DatabaseSync, artifactId: string): LiveArtifactWithTiles {
  const row = getLiveArtifactRow(connection, artifactId);

  if (!row) {
    throw new ChatStorageResolutionError({
      message: `Unknown artifactId: ${artifactId}`,
      statusCode: 404,
      errorCode: "not_found"
    });
  }

  return LiveArtifactWithTilesSchema.parse({
    ...mapLiveArtifactRow(row),
    tiles: listLiveArtifactTiles(connection, artifactId),
    document: row.current_revision_id
      ? getLiveArtifactDocument(connection, row, row.current_revision_id)
      : null
  });
}

function getLiveArtifactDocument(connection: DatabaseSync, artifact: LiveArtifactRow, revisionId: string): LiveArtifactHtmlDocument | null {
  const row = connection
    .prepare(
      `SELECT id, artifact_id, revision_id, format, sanitized_html, data_json, data_schema_json, source_json, sanitizer_version, created_at
       FROM live_artifact_documents
       WHERE artifact_id = ? AND revision_id = ?
       LIMIT 1`
    )
    .get(artifact.id, revisionId) as LiveArtifactDocumentRow | undefined;

  if (!row) {
    return null;
  }

  const inferredSourceJson = row.source_json === null
    ? inferRefreshSourceFromRecentConnectorToolCall(connection, {
      runId: artifact.created_by_run_id,
      beforeToolCallId: artifact.created_by_tool_call_id
    })
    : (JSON.parse(row.source_json) as unknown);
  const baseDocument = {
    format: row.format,
    sanitizedHtml: row.sanitized_html,
    dataJson: JSON.parse(row.data_json) as unknown,
    dataSchemaJson: row.data_schema_json === null ? null : (JSON.parse(row.data_schema_json) as unknown),
    sanitizerVersion: row.sanitizer_version
  };
  const sourceJson = row.source_json === null && inferredSourceJson
    ? LiveArtifactCreateInputSchema.safeParse({
      title: artifact.title,
      description: artifact.description,
      contentType: artifact.content_type,
      document: { ...baseDocument, sourceJson: inferredSourceJson }
    }).success ? inferredSourceJson : null
    : inferredSourceJson;

  return LiveArtifactHtmlDocumentSchema.parse({
    ...baseDocument,
    sourceJson,
  });
}

function inferRefreshSourceFromRecentConnectorToolCall(
  connection: DatabaseSync,
  options: { readonly runId: string | null; readonly beforeToolCallId: string | null }
): LiveArtifactTileSource | null {
  if (!options.runId) {
    return null;
  }

  const beforeToolCall = options.beforeToolCallId ? getToolCallRow(connection, options.beforeToolCallId) : undefined;
  const beforeStartedAt = beforeToolCall?.started_at ?? null;
  const rows = connection
    .prepare(
      `SELECT id, run_id, tool_name, input_json, output_json, output_truncated, output_size_bytes, approval_decision, approval_decided_at, confirmation_token_hash,
              connector_id, connector_name, connector_account_label, connector_tool_name, connector_provider_tool_id, connector_arguments_summary,
              connector_approval_policy_json, connector_provider_execution_id, connector_provider_execution_metadata_json, status, error_message, started_at, ended_at
       FROM tool_calls
       WHERE run_id = ?
         AND status = 'completed'
         AND connector_id IS NOT NULL
         AND connector_provider_tool_id IS NOT NULL
         AND (? IS NULL OR started_at < ?)
       ORDER BY started_at DESC
       LIMIT 5`
    )
    .all(options.runId, beforeStartedAt, beforeStartedAt) as unknown as ToolCallRow[];

  for (const row of rows) {
    const policy = parseConnectorApprovalPolicy(row.connector_approval_policy_json);
    if (!policy || policy.sideEffect !== "read" || policy.approval === "always") {
      continue;
    }

    const input = parseToolCallJsonObject(row.input_json);
    if (!input) {
      continue;
    }
    const dataPaths = inferOutputDataPathsFromToolCallOutput(row.output_json);

    const parsed = LiveArtifactTileSourceSchema.safeParse({
      type: "connector_tool",
      toolName: row.tool_name,
      input,
      connector: {
        connectorId: row.connector_id,
        connectorName: row.connector_name,
        accountLabel: row.connector_account_label,
        providerToolId: row.connector_provider_tool_id
      },
      refreshPermission: "manual_refresh_granted_for_read_only",
      outputMapping: { preferredKind: "json", dataPaths }
    });

    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}

function inferOutputDataPathsFromToolCallOutput(value: string | null): Record<string, string> {
  if (!value) {
    return { data: "$" };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: "$" };
    }

    const entries = Object.keys(parsed)
      .filter(isSafeLiveArtifactDataPathKey)
      .slice(0, 100)
      .map((key) => [key, key] as const);

    return entries.length > 0 ? Object.fromEntries(entries) : { data: "$" };
  } catch {
    return { data: "$" };
  }
}

function isSafeLiveArtifactDataPathKey(value: string): boolean {
  return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(value) && value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

function parseToolCallJsonObject(value: string): Record<string, LiveArtifactJsonValue> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, LiveArtifactJsonValue>;
  } catch {
    return null;
  }
}

function parseConnectorApprovalPolicy(value: string | null): { readonly sideEffect: string; readonly approval: string } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const sideEffect = (parsed as { sideEffect?: unknown }).sideEffect;
    const approval = (parsed as { approval?: unknown }).approval;

    return typeof sideEffect === "string" && typeof approval === "string" ? { sideEffect, approval } : null;
  } catch {
    return null;
  }
}

function listLiveArtifactTiles(connection: DatabaseSync, artifactId: string): LiveArtifactTile[] {
  const rows = connection
    .prepare(
      `SELECT id, artifact_id, schema_version, position, title, kind, render_json, provenance_json, source_json,
              refresh_status, refresh_started_at, last_refreshed_at, last_error, created_at, updated_at
       FROM live_artifact_tiles
       WHERE artifact_id = ?
       ORDER BY position ASC, created_at ASC`
    )
    .all(artifactId) as unknown as LiveArtifactTileRow[];

  return rows.map(mapLiveArtifactTileRow);
}

function getLiveArtifactTileRow(connection: DatabaseSync, tileId: string) {
  return connection
    .prepare(
      `SELECT id, artifact_id, schema_version, position, title, kind, render_json, provenance_json, source_json,
              refresh_status, refresh_started_at, last_refreshed_at, last_error, created_at, updated_at
       FROM live_artifact_tiles
       WHERE id = ?
       LIMIT 1`
    )
    .get(tileId) as LiveArtifactTileRow | undefined;
}

function assertLiveArtifactTileBelongsToArtifact(connection: DatabaseSync, artifactId: string, tileId: string): LiveArtifactTileRow {
  const row = getLiveArtifactTileRow(connection, tileId);

  if (!row || row.artifact_id !== artifactId) {
    throw new ChatStorageResolutionError({
      message: `Unknown tileId for artifact: ${tileId}`,
      statusCode: 404,
      errorCode: "not_found"
    });
  }

  return row;
}

function hasRunningLiveArtifactRefresh(connection: DatabaseSync, artifactId: string): boolean {
  const row = connection
    .prepare(
      `SELECT 1 AS found
       FROM live_artifact_refreshes
       WHERE artifact_id = ? AND status = 'running'
       LIMIT 1`
    )
    .get(artifactId) as { found: number } | undefined;

  return row !== undefined;
}

function insertLiveArtifactTiles(
  connection: DatabaseSync,
  artifactId: string,
  tiles: readonly LiveArtifactCreateTileInput[],
  now: string
): void {
  const insertTile = connection.prepare(
    `INSERT INTO live_artifact_tiles (
       id, artifact_id, schema_version, position, title, kind, render_json, provenance_json, source_json,
       refresh_status, refresh_started_at, last_refreshed_at, last_error, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, NULL, NULL, ?, ?)`
  );

  tiles.forEach((tile, index) => {
    const parsed = LiveArtifactCreateTileInputSchema.parse(tile);

    insertTile.run(
      createPrefixedId("tile"),
      artifactId,
      LIVE_ARTIFACT_SCHEMA_VERSION,
      index,
      parsed.title,
      parsed.kind,
      JSON.stringify(parsed.renderJson),
      parsed.provenanceJson == null ? null : JSON.stringify(parsed.provenanceJson),
      parsed.sourceJson == null ? null : JSON.stringify(parsed.sourceJson),
      now,
      now
    );
  });
}

function insertLiveArtifactDocument(
  connection: DatabaseSync,
  artifactId: string,
  revisionId: string,
  document: LiveArtifactHtmlDocument,
  now: string
): void {
  const parsed = LiveArtifactHtmlDocumentSchema.parse(document);

  connection
    .prepare(
      `INSERT INTO live_artifact_documents (
         id, artifact_id, revision_id, format, sanitized_html, data_json, data_schema_json, source_json, sanitizer_version, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      createPrefixedId("doc"),
      artifactId,
      revisionId,
      parsed.format,
      parsed.sanitizedHtml,
      JSON.stringify(parsed.dataJson),
      parsed.dataSchemaJson == null ? null : JSON.stringify(parsed.dataSchemaJson),
      parsed.sourceJson == null ? null : JSON.stringify(parsed.sourceJson),
      parsed.sanitizerVersion,
      now
    );
}

function hasCompleteLiveArtifactRefreshConnectorMetadata(
  metadata: LiveArtifactRefreshStepConnectorMetadataInput | null | undefined
): metadata is LiveArtifactRefreshStepConnectorMetadataInput {
  if (!metadata) {
    return false;
  }

  return Boolean(
    hasNonEmptyString(metadata.connectorId)
    && hasNonEmptyString(metadata.connectorName)
    && hasNonEmptyString(metadata.connectorToolName)
    && hasNonEmptyString(metadata.connectorProviderToolId)
    && hasNonEmptyString(metadata.connectorArgumentsSummary)
    && hasNonEmptyString(metadata.approvalBasis)
    && metadata.connectorApprovalPolicy !== null
    && metadata.connectorApprovalPolicy !== undefined
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mapLiveArtifactRow(row: LiveArtifactRow): LiveArtifact {
  return LiveArtifactSchema.parse({
    id: row.id,
    schemaVersion: row.schema_version,
    sessionId: row.session_id,
    createdByRunId: row.created_by_run_id,
    createdByToolCallId: row.created_by_tool_call_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    contentType: row.content_type,
    currentRevisionId: row.current_revision_id,
    status: row.status,
    pinned: Boolean(row.pinned),
    refreshStatus: row.refresh_status,
    refreshStartedAt: row.refresh_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRefreshedAt: row.last_refreshed_at,
    lastRefreshError: null
  });
}

function mapLiveArtifactTileRow(row: LiveArtifactTileRow): LiveArtifactTile {
  return LiveArtifactTileSchema.parse({
    id: row.id,
    artifactId: row.artifact_id,
    schemaVersion: row.schema_version,
    position: row.position,
    title: row.title,
    kind: row.kind,
    renderJson: JSON.parse(row.render_json) as unknown,
    provenanceJson: row.provenance_json === null ? null : (JSON.parse(row.provenance_json) as unknown),
    sourceJson: row.source_json === null ? null : (JSON.parse(row.source_json) as unknown),
    refreshStatus: row.refresh_status,
    refreshStartedAt: row.refresh_started_at,
    lastRefreshedAt: row.last_refreshed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function getLiveArtifactRefreshRow(connection: DatabaseSync, refreshId: string) {
  return connection
    .prepare(
      `SELECT id, artifact_id, scope, requested_tile_id, status, trigger, started_at, ended_at, error_message
       FROM live_artifact_refreshes
       WHERE id = ?
       LIMIT 1`
    )
    .get(refreshId) as LiveArtifactRefreshRow | undefined;
}

function getLiveArtifactRefreshOrThrow(connection: DatabaseSync, refreshId: string): StoredLiveArtifactRefresh {
  const row = getLiveArtifactRefreshRow(connection, refreshId);

  if (!row) {
    throw new ChatStorageResolutionError({
      message: `Unknown live artifact refreshId: ${refreshId}`,
      statusCode: 404,
      errorCode: "not_found"
    });
  }

  return mapLiveArtifactRefreshRow(row);
}

function mapLiveArtifactRefreshRow(row: LiveArtifactRefreshRow): StoredLiveArtifactRefresh {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    scope: row.scope,
    requestedTileId: row.requested_tile_id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    errorMessage: row.error_message
  };
}

function getLiveArtifactRefreshStepRow(connection: DatabaseSync, stepId: string) {
  return connection
    .prepare(
      `SELECT id, refresh_id, tile_id, source_type, tool_name, input_json,
              connector_id, connector_name, connector_account_label, connector_tool_name,
              connector_provider_tool_id, connector_arguments_summary, connector_approval_policy_json,
              approval_basis, connector_provider_execution_id, connector_provider_execution_metadata_json,
              status, error_message, started_at, ended_at
       FROM live_artifact_refresh_steps
       WHERE id = ?
       LIMIT 1`
    )
    .get(stepId) as LiveArtifactRefreshStepRow | undefined;
}

function getLiveArtifactRefreshStepOrThrow(connection: DatabaseSync, stepId: string): StoredLiveArtifactRefreshStep {
  const row = getLiveArtifactRefreshStepRow(connection, stepId);

  if (!row) {
    throw new ChatStorageResolutionError({
      message: `Unknown live artifact refresh stepId: ${stepId}`,
      statusCode: 404,
      errorCode: "not_found"
    });
  }

  return mapLiveArtifactRefreshStepRow(row);
}

function mapLiveArtifactRefreshStepRow(row: LiveArtifactRefreshStepRow): StoredLiveArtifactRefreshStep {
  return {
    id: row.id,
    refreshId: row.refresh_id,
    tileId: row.tile_id,
    sourceType: row.source_type,
    toolName: row.tool_name,
    input: JSON.parse(row.input_json) as unknown,
    connectorId: row.connector_id,
    connectorName: row.connector_name,
    connectorAccountLabel: row.connector_account_label,
    connectorToolName: row.connector_tool_name,
    connectorProviderToolId: row.connector_provider_tool_id,
    connectorArgumentsSummary: row.connector_arguments_summary,
    connectorApprovalPolicy: row.connector_approval_policy_json === null ? null : (JSON.parse(row.connector_approval_policy_json) as unknown),
    approvalBasis: row.approval_basis,
    connectorProviderExecutionId: row.connector_provider_execution_id,
    connectorProviderExecutionMetadata: row.connector_provider_execution_metadata_json === null ? null : (JSON.parse(row.connector_provider_execution_metadata_json) as unknown),
    status: row.status,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

function truncateLiveArtifactError(message: string): string {
  const normalized = message.trim() || "Live artifact refresh failed.";
  return normalized.length > LIVE_ARTIFACT_LIMITS.error ? `${normalized.slice(0, LIVE_ARTIFACT_LIMITS.error - 1)}…` : normalized;
}

function parseLiveArtifactUpdateInput(input: UpdateLiveArtifactInput, existing: LiveArtifactRow): { title: string; description: string | null } {
  const parsed = LiveArtifactSchema.pick({ title: true, description: true }).parse({
    title: input.title ?? existing.title,
    description: input.description === undefined ? existing.description : input.description
  });

  return {
    title: parsed.title,
    description: parsed.description ?? null
  };
}

function clampLiveArtifactListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return LIVE_ARTIFACT_LIST_LIMIT_DEFAULT;
  }

  if (!Number.isFinite(limit)) {
    return LIVE_ARTIFACT_LIST_LIMIT_DEFAULT;
  }

  return Math.min(LIVE_ARTIFACT_LIST_LIMIT_MAX, Math.max(1, Math.trunc(limit)));
}

function createUniqueLiveArtifactSlug(connection: DatabaseSync, title: string, fallbackId: string): string {
  const base = slugifyLiveArtifactTitle(title) || fallbackId.replace(/_/g, "-").toLowerCase();
  let candidate = base;
  let suffix = 2;

  while (liveArtifactSlugExists(connection, candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 180 - suffixText.length)).replace(/-+$/u, "")}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}

function liveArtifactSlugExists(connection: DatabaseSync, slug: string): boolean {
  const row = connection
    .prepare("SELECT 1 AS exists_flag FROM live_artifacts WHERE slug = ? LIMIT 1")
    .get(slug) as { exists_flag: number } | undefined;

  return row != null;
}

function slugifyLiveArtifactTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-")
    .slice(0, 180)
    .replace(/-+$/u, "");
}

const COMPOSIO_PROVIDER_SETTINGS_KEY = "connector_provider_composio";
const DEFAULT_COMPOSIO_PROVIDER_SETTINGS: ConnectorProviderComposioSettingsRow = {
  apiKey: null,
  baseUrl: "https://backend.composio.dev",
  timeoutMs: null,
  authConfigIds: {}
};

function getConnectorProviderComposioSettings(connection: DatabaseSync): StoredConnectorProviderComposioSettings {
  const row = getLocalAppSettingRow(connection, COMPOSIO_PROVIDER_SETTINGS_KEY);
  const defaults = parseConnectorProviderComposioSettings({
    apiKey: DEFAULT_COMPOSIO_PROVIDER_SETTINGS.apiKey,
    baseUrl: DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl,
    timeoutMs: DEFAULT_COMPOSIO_PROVIDER_SETTINGS.timeoutMs,
    authConfigIds: DEFAULT_COMPOSIO_PROVIDER_SETTINGS.authConfigIds
  });

  if (!row) {
    const now = new Date().toISOString();

    return {
      key: COMPOSIO_PROVIDER_SETTINGS_KEY,
      apiKey: defaults.apiKey,
      baseUrl: defaults.baseUrl,
      timeoutMs: defaults.timeoutMs,
      authConfigIds: defaults.authConfigIds,
      createdAt: now,
      updatedAt: now
    };
  }

  const parsed = parseConnectorProviderComposioSettings(row.value);

  return {
    key: COMPOSIO_PROVIDER_SETTINGS_KEY,
    apiKey: parsed.apiKey,
    baseUrl: parsed.baseUrl,
    timeoutMs: parsed.timeoutMs,
    authConfigIds: parsed.authConfigIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseConnectorProviderComposioSettings(value: string | ConnectorProviderComposioSettingsRow): ConnectorProviderComposioSettingsRow {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Partial<ConnectorProviderComposioSettingsStorage>;
        const baseUrl = parseConnectorProviderComposioBaseUrl(record.baseUrl) ?? DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl;
        const timeoutMs = parseConnectorProviderComposioTimeoutMs(record.timeoutMs);

        return {
          apiKey: parseConnectorProviderComposioApiKey(record.apiKey),
          baseUrl,
          timeoutMs,
          authConfigIds: normalizeConnectorProviderComposioAuthConfigIds(record.authConfigIds)
        };
      }
    } catch {
      // fallthrough to defaults
    }
  }

  return {
    apiKey: parseConnectorProviderComposioApiKey((value as ConnectorProviderComposioSettingsRow).apiKey),
    baseUrl: parseConnectorProviderComposioBaseUrl((value as ConnectorProviderComposioSettingsRow).baseUrl) ?? DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl,
    timeoutMs: parseConnectorProviderComposioTimeoutMs((value as ConnectorProviderComposioSettingsRow).timeoutMs),
    authConfigIds: normalizeConnectorProviderComposioAuthConfigIds((value as ConnectorProviderComposioSettingsRow).authConfigIds)
  };
}

function normalizeConnectorProviderComposioSettings(
  input: Readonly<ConnectorProviderComposioSettingsStorage>
): StoredConnectorProviderComposioSettings {
  return {
    key: input.key,
    apiKey: parseConnectorProviderComposioApiKey(input.apiKey),
    baseUrl:
      parseConnectorProviderComposioBaseUrl(input.baseUrl) ??
      parseConnectorProviderComposioBaseUrl(DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl) ??
      DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl,
    timeoutMs: parseConnectorProviderComposioTimeoutMs(input.timeoutMs),
    authConfigIds: normalizeConnectorProviderComposioAuthConfigIds(input.authConfigIds),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function parseConnectorProviderComposioSettingsInput(
  input: ReplaceConnectorProviderComposioSettingsInput,
  existing: StoredConnectorProviderComposioSettings
): ConnectorProviderComposioSettingsStorage {
  const now = new Date().toISOString();

  return {
    key: COMPOSIO_PROVIDER_SETTINGS_KEY,
    apiKey: input.apiKey === undefined ? existing.apiKey : parseConnectorProviderComposioApiKey(input.apiKey),
    baseUrl: input.baseUrl === undefined ? existing.baseUrl : parseConnectorProviderComposioBaseUrl(input.baseUrl) ?? DEFAULT_COMPOSIO_PROVIDER_SETTINGS.baseUrl,
    timeoutMs: input.timeoutMs === undefined ? existing.timeoutMs : parseConnectorProviderComposioTimeoutMs(input.timeoutMs),
    authConfigIds: input.authConfigIds === undefined ? existing.authConfigIds : normalizeConnectorProviderComposioAuthConfigIds(input.authConfigIds),
    createdAt: now,
    updatedAt: now
  };
}

function parseConnectorProviderComposioApiKey(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseConnectorProviderComposioBaseUrl(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : null;

  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function parseConnectorProviderComposioTimeoutMs(value: unknown): number | null {
  if (value === null || value === undefined) {
    return DEFAULT_COMPOSIO_PROVIDER_SETTINGS.timeoutMs;
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_COMPOSIO_PROVIDER_SETTINGS.timeoutMs;
}

function normalizeConnectorProviderComposioAuthConfigIds(value: unknown): Partial<Record<ConnectorId, string>> {
  const normalized: Partial<Record<ConnectorId, string>> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalized;
  }

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "github" && key !== "notion" && key !== "google_drive") {
      continue;
    }

    const parsedValue = parseConnectorProviderComposioApiKey(rawValue);

    if (parsedValue) {
      normalized[key] = parsedValue;
    }
  }

  return normalized;
}

function toConnectorProviderComposioStoragePayload(settings: StoredConnectorProviderComposioSettings) {
  return {
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    timeoutMs: settings.timeoutMs,
    authConfigIds: settings.authConfigIds
  };
}

function ensureMonetInstallId(connection: DatabaseSync): string {
  const existingInstallId = getMonetInstallIdRow(connection)?.value.trim();

  if (existingInstallId) {
    return existingInstallId;
  }

  const now = new Date().toISOString();
  const installId = randomUUID();

  connection
    .prepare(
      `INSERT INTO local_app_settings (key, value, created_at, updated_at)
       VALUES ('monet_install_id', ?, ?, ?)
       ON CONFLICT(key) DO NOTHING`
    )
    .run(installId, now, now);

  return getMonetInstallId(connection);
}

function getMonetInstallId(connection: DatabaseSync): string {
  const installId = getMonetInstallIdRow(connection)?.value.trim();

  if (!installId) {
    return ensureMonetInstallId(connection);
  }

  return installId;
}

function getLocalAppSettingRow(connection: DatabaseSync, key: string) {
  return connection
    .prepare(
      `SELECT key, value, created_at, updated_at
       FROM local_app_settings
       WHERE key = ?
       LIMIT 1`
    )
    .get(key) as LocalAppSettingRow | undefined;
}

function getMonetInstallIdRow(connection: DatabaseSync) {
  return getLocalAppSettingRow(connection, "monet_install_id");
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

  const fallback = getFirstEnabledProviderModel(connection);

  if (!fallback) {
    throw new ChatStorageResolutionError({
      message: "No fallback provider/model is currently available for new chats.",
      statusCode: 422,
      errorCode: "provider_model_unresolved"
    });
  }

  return {
    providerId: fallback.providerId,
    modelId: fallback.modelId
  };
}

function getSession(connection: DatabaseSync, id: string) {
  return connection
    .prepare(
      `SELECT sessions.id, sessions.title, sessions.created_at, sessions.updated_at, sessions.archived_at,
              sessions.default_provider_id, sessions.default_model_id, COUNT(messages.id) AS message_count
       FROM sessions
       LEFT JOIN messages ON messages.session_id = sessions.id
       WHERE sessions.id = ?
       GROUP BY sessions.id
       LIMIT 1`
    )
    .get(id) as SessionRow | undefined;
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

function getFirstEnabledProviderModel(connection: DatabaseSync) {
  const row = connection
    .prepare(
      `SELECT providers.id AS provider_id, provider_models.id AS model_id
       FROM providers
       INNER JOIN provider_models ON provider_models.provider_id = providers.id
       WHERE providers.enabled = 1 AND provider_models.enabled = 1
       ORDER BY providers.display_name ASC, provider_models.display_name ASC, provider_models.created_at ASC
       LIMIT 1`
    )
    .get() as { provider_id: string; model_id: string } | undefined;

  return row
    ? {
        providerId: row.provider_id,
        modelId: row.model_id
      }
    : null;
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
        consumed_tokens,
        consumed_tool_calls,
        max_steps,
        max_tokens_per_run,
        wall_clock_deadline_at,
        finish_reason,
        started_at,
        ended_at
      ) VALUES (?, ?, 'running', ?, ?, 0, 0, 0, ?, ?, ?, NULL, ?, NULL)`
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
    const persistedMessage = normalizePersistedMessage(connection, options.sessionId, message);

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
    defaultModelId: row.default_model_id,
    messageCount: row.message_count ?? 0
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
    consumedTokens: row.consumed_tokens,
    consumedToolCalls: row.consumed_tool_calls,
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

function mapConnectorConnectionRow(row: ConnectorConnectionRow): StoredConnectorConnection {
  return {
    id: row.id,
    userId: row.user_id,
    connectorId: row.connector_id,
    provider: row.provider,
    providerConnectionId: row.provider_connection_id,
    providerMetadataJson: row.provider_metadata_json,
    accountLabel: row.account_label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error
  };
}

function mapConnectorOAuthStateRow(row: ConnectorOAuthStateRow): StoredConnectorOAuthState {
  return {
    id: row.id,
    stateHash: row.state_hash,
    userId: row.user_id,
    connectorId: row.connector_id,
    provider: row.provider,
    redirectUrl: row.redirect_url,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at
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
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean).map((path) => resolve(path)))).sort((left, right) =>
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

  if (part.type === "unknown" && isObjectRecord(part.raw) && isKnownUiMessagePart(part.raw)) {
    return part.raw;
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
    return typeof part.state === "string";
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
      return (part.title === undefined || typeof part.title === "string") && typeof part.url === "string";
    case "source-document":
      return part.title === undefined || typeof part.title === "string";
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

function normalizePersistedMessage(connection: DatabaseSync, sessionId: string, message: UIMessage) {
  const idempotencyKey = message.id?.trim() || createPrefixedId("msg");
  const existingId = getExistingMessageIdByIdempotencyKey(connection, sessionId, idempotencyKey);
  const preferredId = hasIdPrefix(idempotencyKey, "msg") ? idempotencyKey : createPrefixedId("msg");
  const id = existingId ?? (messageIdExists(connection, preferredId) ? createPrefixedId("msg") : preferredId);
  const persistedMessage = sanitizePersistedMessage(message);

  return {
    id,
    idempotencyKey,
    message: {
      ...persistedMessage,
      id
    }
  };
}

function getExistingMessageIdByIdempotencyKey(connection: DatabaseSync, sessionId: string, idempotencyKey: string) {
  const row = connection
    .prepare("SELECT id FROM messages WHERE session_id = ? AND idempotency_key = ? LIMIT 1")
    .get(sessionId, idempotencyKey) as { id: string } | undefined;

  return row?.id ?? null;
}

function messageIdExists(connection: DatabaseSync, id: string) {
  const row = connection
    .prepare("SELECT 1 AS exists_flag FROM messages WHERE id = ? LIMIT 1")
    .get(id) as { exists_flag: number } | undefined;

  return row != null;
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
  return JSON.stringify(sanitizeToolCallPersistenceValue(value ?? null));
}

function serializeToolCallOutput(value: unknown) {
  const serialized = serializeToolCallPayload(value);
  const outputSizeBytes = Buffer.byteLength(serialized, "utf8");

   if (outputSizeBytes <= MAX_PERSISTED_TOOL_OUTPUT_BYTES) {
    return {
      value: serialized,
      outputSizeBytes,
      outputTruncated: false
    };
  }

  const truncated = {
    truncated: true,
    outputSizeBytes,
    preview: truncateSerializedValue(serialized, 1_200)
  };

  return {
    value: JSON.stringify(truncated),
    outputSizeBytes,
    outputTruncated: true
  };
}

function sanitizePersistedMessage(message: UIMessage): UIMessage {
  const parts = (message.parts ?? []).map((part) => sanitizePersistedMessagePart(part)) as UIMessage["parts"];

  return {
    ...message,
    parts
  };
}

function sanitizePersistedMessagePart(part: unknown) {
  if (!isObjectRecord(part)) {
    return part;
  }

  const type = typeof part.type === "string" ? part.type : "";
  const toolName = getStoredToolPartName(part);

  if ((type === "dynamic-tool" || type.startsWith("tool-")) && toolName != null && "output" in part) {
    const output = (part as { output?: unknown }).output;
    const serialized = serializeToolCallPayload(output);
    const outputSizeBytes = Buffer.byteLength(serialized, "utf8");
    const shouldTruncate =
      ALWAYS_TRUNCATED_PERSISTED_TOOL_NAMES.has(toolName) || outputSizeBytes > MAX_PERSISTED_TOOL_OUTPUT_BYTES;

    if (shouldTruncate) {
      return {
        ...part,
        output: {
          truncated: true,
          toolName,
          outputSizeBytes,
          preview: truncateSerializedValue(serialized, 1_200)
        }
      };
    }
  }

  return part;
}

function getStoredToolPartName(part: Record<string, unknown>) {
  if (typeof part.toolName === "string" && part.toolName.trim().length > 0) {
    return part.toolName;
  }

  return typeof part.type === "string" && part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null;
}

function truncateSerializedValue(serialized: string, maxLength: number) {
  if (serialized.length <= maxLength) {
    return serialized;
  }

  return `${serialized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isReasoningModelName(modelName: string) {
  return /^(o1|o3|o4)/i.test(modelName) || /reason/i.test(modelName);
}
