import { createHash } from "node:crypto";

import type { ChatStorage } from "../chat-storage";
import type { ComposioProviderConfig } from "../config";
import { getConnectorCatalogItem, listConnectorCatalog, type ConnectorCatalogItem, type ConnectorId } from "./catalog";
import { createConnectorProviderError, normalizeConnectorProviderError, type ConnectorProviderErrorCode } from "./errors";
import type {
  ConnectorConnectionInput,
  ConnectorConnectionStart,
  ConnectorConnectionStatus,
  ConnectorCreateConnectionInput,
  ConnectorExecuteToolInput,
  ConnectorListToolsInput,
  ConnectorProvider,
  ConnectorToolDefinition,
  ConnectorToolResult
} from "./provider";

const COMPOSIO_PROVIDER = "composio";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type ConnectorStorage = Pick<ChatStorage, "createConnectorOAuthState" | "getConnectorConnection">;

interface ComposioConnectedAccountResponse {
  readonly id?: unknown;
  readonly nanoid?: unknown;
  readonly status?: unknown;
  readonly state?: unknown;
  readonly redirect_url?: unknown;
  readonly redirectUrl?: unknown;
  readonly callback_url?: unknown;
  readonly user_id?: unknown;
  readonly toolkit?: {
    readonly slug?: unknown;
  };
  readonly auth_config?: {
    readonly id?: unknown;
  };
  readonly data?: unknown;
}

export interface ComposioConnectorProviderOptions {
  readonly config: ComposioProviderConfig;
  readonly storage: ConnectorStorage;
}

export class ComposioConnectorProvider implements ConnectorProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number | null;
  private readonly authConfigIds: Partial<Record<ConnectorId, string>>;
  private readonly storage: ConnectorStorage;

  constructor(options: ComposioConnectorProviderOptions) {
    this.baseUrl = options.config.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.config.apiKey;
    this.timeoutMs = options.config.timeoutMs;
    this.authConfigIds = options.config.authConfigIds;
    this.storage = options.storage;
  }

  async listConnectors(): Promise<readonly ConnectorCatalogItem[]> {
    return listConnectorCatalog();
  }

  async getConnectionStatus(input: ConnectorConnectionInput): Promise<ConnectorConnectionStatus> {
    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    if (!this.apiKey || !this.authConfigIds[input.connectorId]) {
      return {
        connectorId: input.connectorId,
        state: "unavailable",
        connected: false,
        lastErrorCode: "provider_error",
        lastErrorMessage: "Connector provider is not configured."
      };
    }

    const connection = this.storage.getConnectorConnection({
      userId: input.userId,
      connectorId: input.connectorId,
      provider: COMPOSIO_PROVIDER
    });

    if (!connection || connection.status === "disconnected") {
      return {
        connectorId: input.connectorId,
        state: connection?.status === "disconnected" ? "disconnected" : "not_connected",
        connected: false
      };
    }

    const localStatus = mapPersistedConnectionStatus(input.connectorId, connection);

    if (!connection.providerConnectionId || connection.status !== "connected") {
      return localStatus;
    }

    try {
      const providerConnection = await this.requestConnectedAccount(connection.providerConnectionId, input.abortSignal);
      return mapComposioConnectionStatus(input.connectorId, connection, providerConnection);
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error, {
        fallbackCode: "provider_error",
        message: "Unable to refresh connector connection status."
      });

      if (normalized.code === "connection_expired" || normalized.code === "connection_missing" || normalized.statusCode === 404) {
        return {
          ...localStatus,
          state: "expired",
          connected: false,
          lastErrorCode: "connection_expired",
          lastErrorMessage: "Connector account credentials have expired. Reconnect to continue."
        };
      }

      return {
        ...localStatus,
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message
      };
    }
  }

  async connect(input: ConnectorCreateConnectionInput): Promise<ConnectorConnectionStart> {
    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    const authConfigId = this.authConfigIds[input.connectorId];

    if (!this.apiKey || !authConfigId) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    this.storage.createConnectorOAuthState({
      stateHash: hashOAuthState(input.state),
      userId: input.userId,
      connectorId: input.connectorId,
      provider: COMPOSIO_PROVIDER,
      ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
      expiresAt
    });

    const providerConnection = await this.createConnectedAccount(
      {
        authConfigId,
        userId: input.userId,
        state: input.state,
        ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {})
      },
      input.abortSignal
    );

    const redirectUrl = getString(providerConnection.redirect_url) ?? getString(providerConnection.redirectUrl);
    const providerConnectionId = getComposioConnectionId(providerConnection);
    const status = getString(providerConnection.status)?.toUpperCase();

    return {
      connectorId: input.connectorId,
      kind: redirectUrl ? "redirect_required" : status === "ACTIVE" ? "connected" : "pending",
      ...(providerConnectionId ? { providerConnectionId } : {}),
      ...(redirectUrl ? { redirectUrl } : {}),
      expiresAt
    };
  }

  async disconnect(_input: ConnectorConnectionInput): Promise<void> {
    throw createConnectorProviderError("provider_error", { message: "Composio connector disconnect is not implemented yet." });
  }

  async listTools(_input: ConnectorListToolsInput): Promise<readonly ConnectorToolDefinition[]> {
    return [];
  }

  async executeTool(_input: ConnectorExecuteToolInput): Promise<ConnectorToolResult> {
    throw createConnectorProviderError("tool_not_found", { message: "Composio connector tool execution is not implemented yet." });
  }

  private async createConnectedAccount(
    input: { authConfigId: string; userId: string; state: string; redirectUrl?: string },
    abortSignal: AbortSignal | undefined
  ): Promise<ComposioConnectedAccountResponse> {
    return this.requestJson("/api/v3/connected_accounts", {
      method: "POST",
      body: JSON.stringify({
        auth_config_id: input.authConfigId,
        user_id: input.userId,
        state: input.state,
        ...(input.redirectUrl ? { callback_url: input.redirectUrl } : {})
      }),
      ...(abortSignal ? { abortSignal } : {})
    });
  }

  private async requestConnectedAccount(connectionId: string, abortSignal: AbortSignal | undefined): Promise<ComposioConnectedAccountResponse> {
    return this.requestJson(`/api/v3/connected_accounts/${encodeURIComponent(connectionId)}`, {
      method: "GET",
      ...(abortSignal ? { abortSignal } : {})
    });
  }

  private async requestJson(path: string, input: { method: string; body?: string; abortSignal?: AbortSignal }): Promise<ComposioConnectedAccountResponse> {
    if (!this.apiKey) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const signal = combineAbortSignal(input.abortSignal, this.timeoutMs);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey
      },
      ...(input.body ? { body: input.body } : {}),
      ...(signal ? { signal } : {})
    });

    if (!response.ok) {
      throw createConnectorProviderError(mapComposioHttpStatus(response.status), { statusCode: response.status });
    }

    const value = (await response.json()) as unknown;

    if (!value || typeof value !== "object") {
      throw createConnectorProviderError("provider_error", { message: "Connector provider returned an invalid response." });
    }

    return value as ComposioConnectedAccountResponse;
  }
}

function mapPersistedConnectionStatus(
  connectorId: ConnectorId,
  connection: ReturnType<ConnectorStorage["getConnectorConnection"]> & {}
): ConnectorConnectionStatus {
  const metadata = parseProviderMetadata(connection.providerMetadataJson);
  const lastError = parseLastError(connection.lastError);
  const state = connection.status === "connected" ? "connected" : connection.status;
  const accountId = getString(metadata.accountId);
  const providerConnectorId = getString(metadata.providerConnectorId);

  return {
    connectorId,
    state,
    connected: state === "connected",
    account: {
      ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {}),
      ...(accountId ? { accountId } : {}),
      ...(connection.providerConnectionId ? { providerConnectionId: connection.providerConnectionId } : {}),
      ...(providerConnectorId ? { providerConnectorId } : {}),
      ...(connection.lastConnectedAt ? { connectedAt: connection.lastConnectedAt } : {}),
      updatedAt: connection.updatedAt
    },
    ...(lastError.code ? { lastErrorCode: lastError.code } : {}),
    ...(lastError.message ? { lastErrorMessage: lastError.message } : {})
  };
}

function mapComposioConnectionStatus(
  connectorId: ConnectorId,
  connection: ReturnType<ConnectorStorage["getConnectorConnection"]> & {},
  providerConnection: ComposioConnectedAccountResponse
): ConnectorConnectionStatus {
  const providerStatus = getString(providerConnection.status)?.toUpperCase();
  const localStatus = mapPersistedConnectionStatus(connectorId, connection);

  if (providerStatus === "ACTIVE") {
    return {
      ...localStatus,
      state: "connected",
      connected: true
    };
  }

  if (providerStatus === "EXPIRED" || providerStatus === "FAILED" || providerStatus === "DISABLED") {
    return {
      ...localStatus,
      state: "expired",
      connected: false,
      lastErrorCode: "connection_expired",
      lastErrorMessage: "Connector account credentials have expired. Reconnect to continue."
    };
  }

  return {
    ...localStatus,
    state: providerStatus === "INITIATED" || providerStatus === "INITIALIZING" ? "not_connected" : localStatus.state,
    connected: providerStatus === "INITIATED" || providerStatus === "INITIALIZING" ? false : localStatus.connected
  };
}

function parseProviderMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseLastError(value: string | null): { code?: ConnectorConnectionStatus["lastErrorCode"]; message?: string } {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return { message: value };
    }

    const code = "code" in parsed && typeof parsed.code === "string" ? parsed.code : undefined;
    const message = "message" in parsed && typeof parsed.message === "string" ? parsed.message : undefined;

    return {
      ...(isConnectorLastErrorCode(code) ? { code } : {}),
      ...(message ? { message } : {})
    };
  } catch {
    return { message: value };
  }
}

function getComposioConnectionId(response: ComposioConnectedAccountResponse): string | undefined {
  return getString(response.id) ?? getString(response.nanoid);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function mapComposioHttpStatus(status: number): ConnectorProviderErrorCode {
  if (status === 401) {
    return "connection_expired";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 404) {
    return "connection_missing";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "upstream_unavailable";
  }

  return "provider_error";
}

function isConnectorLastErrorCode(value: string | undefined): value is ConnectorConnectionStatus["lastErrorCode"] {
  return Boolean(
    value &&
      [
        "connection_missing",
        "connection_expired",
        "rate_limited",
        "upstream_unavailable",
        "invalid_arguments",
        "forbidden",
        "tool_not_found",
        "provider_error"
      ].includes(value)
  );
}

function combineAbortSignal(abortSignal: AbortSignal | undefined, timeoutMs: number | null): AbortSignal | undefined {
  if (!timeoutMs) {
    return abortSignal;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;
}
