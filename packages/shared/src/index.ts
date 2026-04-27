import { createId as createCuid2 } from "@paralleldrive/cuid2";

export const sharedPackageName = "@monet/shared";

export const uiMessageSchemaVersion = "v1";

export const idPrefixes = {
  session: "ses",
  message: "msg",
  run: "run",
  toolCall: "tcl",
  provider: "pro",
  providerModel: "mod"
} as const;

type IdPrefix = (typeof idPrefixes)[keyof typeof idPrefixes];
type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type MonetId<TPrefix extends IdPrefix = IdPrefix> = Brand<`${TPrefix}_${string}`, "MonetId">;
export type SessionId = MonetId<typeof idPrefixes.session>;
export type MessageId = MonetId<typeof idPrefixes.message>;
export type RunId = MonetId<typeof idPrefixes.run>;
export type ToolCallId = MonetId<typeof idPrefixes.toolCall>;
export type ProviderId = MonetId<typeof idPrefixes.provider>;
export type ProviderModelId = MonetId<typeof idPrefixes.providerModel>;

export type ProviderType = "openai" | "openrouter";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "interrupted";
export type ToolCallStatus = "pending" | "running" | "completed" | "failed";
export type ToolApprovalDecision = "approved" | "rejected";
export type MessageRole = "system" | "user" | "assistant" | "tool";

export function createMonetId<TPrefix extends IdPrefix>(prefix: TPrefix): MonetId<TPrefix> {
  return `${prefix}_${createCuid2()}` as MonetId<TPrefix>;
}

export function isMonetId<TPrefix extends IdPrefix>(value: string, prefix: TPrefix): value is MonetId<TPrefix> {
  return value.startsWith(`${prefix}_`) && value.length > prefix.length + 1;
}

export function assertMonetId<TPrefix extends IdPrefix>(value: string, prefix: TPrefix): MonetId<TPrefix> {
  if (!isMonetId(value, prefix)) {
    throw new Error(`Expected ${prefix}_ prefixed id, received: ${value}`);
  }

  return value;
}

export function nowAsIsoString(date: Date = new Date()): string {
  return date.toISOString();
}

export interface StoredUiMessage<TParts = unknown> {
  id: MessageId;
  role: MessageRole;
  parts: TParts[];
  metadata?: Record<string, unknown>;
}

export interface SessionRecord {
  id: SessionId;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  defaultProviderId: ProviderId | null;
  defaultModelId: ProviderModelId | null;
}

export interface MessageRecord {
  id: MessageId;
  sessionId: SessionId;
  runId: RunId | null;
  role: MessageRole;
  uiMessageJson: string;
  uiMessageSchemaVersion: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface RunRecord {
  id: RunId;
  sessionId: SessionId;
  status: RunStatus;
  providerId: ProviderId;
  modelId: ProviderModelId;
  currentStep: number;
  maxSteps: number;
  maxTokensPerRun: number | null;
  wallClockDeadlineAt: string | null;
  finishReason: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ToolCallRecord {
  id: ToolCallId;
  runId: RunId;
  toolName: string;
  inputJson: string;
  outputJson: string | null;
  outputTruncated: boolean;
  outputSizeBytes: number | null;
  approvalDecision: ToolApprovalDecision | null;
  approvalDecidedAt: string | null;
  confirmationTokenHash: string | null;
  status: ToolCallStatus;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface ProviderRecord {
  id: ProviderId;
  type: ProviderType;
  displayName: string;
  baseUrl: string | null;
  defaultModelName: string | null;
  enabled: boolean;
  timeoutMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModelRecord {
  id: ProviderModelId;
  providerId: ProviderId;
  modelName: string;
  displayName: string;
  supportsTools: boolean;
  supportsReasoning: boolean;
  enabled: boolean;
  capabilitiesJson: string | null;
  createdAt: string;
  updatedAt: string;
}
