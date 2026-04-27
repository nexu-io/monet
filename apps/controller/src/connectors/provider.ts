import type { ConnectorCatalogItem, ConnectorId, ConnectorToolPolicy } from "./catalog";
import type { ConnectorProviderErrorCode } from "./errors";

export type ConnectorConnectionState = "unavailable" | "not_connected" | "connected" | "expired" | "disconnected";

export interface ConnectorAccountMetadata {
  readonly accountLabel?: string;
  readonly accountId?: string;
  readonly providerConnectionId?: string;
  readonly providerConnectorId?: string;
  readonly connectedAt?: string;
  readonly updatedAt?: string;
}

export interface ConnectorConnectionStatus {
  readonly connectorId: ConnectorId;
  readonly state: ConnectorConnectionState;
  readonly connected: boolean;
  readonly account?: ConnectorAccountMetadata;
  readonly lastErrorCode?: ConnectorProviderErrorCode;
  readonly lastErrorMessage?: string;
}

export type ConnectorConnectionStartKind = "redirect_required" | "pending" | "connected";

export interface ConnectorConnectionStart {
  readonly connectorId: ConnectorId;
  readonly kind: ConnectorConnectionStartKind;
  readonly providerConnectionId?: string;
  readonly redirectUrl?: string;
  readonly expiresAt?: string;
}

export interface ConnectorToolJsonSchema {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Record<string, unknown>;
  readonly [keyword: string]: unknown;
}

export interface ConnectorToolDefinition {
  readonly connectorId: ConnectorId;
  readonly providerToolId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: ConnectorToolJsonSchema;
  readonly policy: ConnectorToolPolicy;
}

export interface ConnectorToolResult {
  readonly output: unknown;
  readonly providerExecutionId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ConnectorUserInput {
  readonly userId: string;
  readonly abortSignal?: AbortSignal;
}

export interface ConnectorConnectionInput extends ConnectorUserInput {
  readonly connectorId: ConnectorId;
}

export interface ConnectorCreateConnectionInput extends ConnectorConnectionInput {
  readonly redirectUrl?: string;
  readonly state: string;
}

export interface ConnectorListToolsInput extends ConnectorUserInput {
  readonly connectorId?: ConnectorId;
}

export interface ConnectorExecuteToolInput extends ConnectorUserInput {
  readonly toolId: string;
  readonly args: unknown;
  readonly connectionId?: string;
  readonly abortSignal: AbortSignal;
}

export interface ConnectorProvider {
  listConnectors(): Promise<readonly ConnectorCatalogItem[]>;
  getConnectionStatus(input: ConnectorConnectionInput): Promise<ConnectorConnectionStatus>;
  connect(input: ConnectorCreateConnectionInput): Promise<ConnectorConnectionStart>;
  disconnect(input: ConnectorConnectionInput): Promise<void>;
  listTools(input: ConnectorListToolsInput): Promise<readonly ConnectorToolDefinition[]>;
  executeTool(input: ConnectorExecuteToolInput): Promise<ConnectorToolResult>;
}
