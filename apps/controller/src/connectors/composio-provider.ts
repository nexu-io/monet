import type { ChatStorage } from "../chat-storage";
import type { ComposioProviderConfig } from "../config";
import {
  classifyConnectorToolSafety,
  getConnectorCatalogItem,
  listConnectorCatalog,
  type ConnectorAllowedTool,
  type ConnectorCatalogItem,
  type ConnectorId
} from "./catalog";
import { createConnectorProviderError, normalizeConnectorProviderError, type ConnectorProviderErrorCode } from "./errors";
import { hashConnectorOAuthState } from "./oauth-state";
import type {
  ConnectorCompleteConnectionInput,
  ConnectorConnectionInput,
  ConnectorConnectionStart,
  ConnectorConnectionStatus,
  ConnectorCreateConnectionInput,
  ConnectorExecuteToolInput,
  ConnectorListToolsInput,
  ConnectorProvider,
  ConnectorReconciledConnection,
  ConnectorToolDefinition,
  ConnectorToolJsonSchema,
  ConnectorToolResult
} from "./provider";

const COMPOSIO_PROVIDER = "composio";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const KNOWN_COMPOSIO_SAFETY_HINTS = new Set(["readOnlyHint", "destructiveHint", "idempotentHint"]);

type ConnectorStorage = Pick<ChatStorage, "createConnectorOAuthState" | "getConnectorConnection" | "getConnectorProviderComposioSettings">;

interface ComposioConnectedAccountResponse {
  readonly id?: unknown;
  readonly nanoid?: unknown;
  readonly connected_account_id?: unknown;
  readonly connectedAccountId?: unknown;
  readonly status?: unknown;
  readonly state?: unknown;
  readonly redirect_url?: unknown;
  readonly redirectUrl?: unknown;
  readonly callback_url?: unknown;
  readonly user_id?: unknown;
  readonly userId?: unknown;
  readonly account_id?: unknown;
  readonly accountId?: unknown;
  readonly account_label?: unknown;
  readonly accountLabel?: unknown;
  readonly name?: unknown;
  readonly email?: unknown;
  readonly status_reason?: unknown;
  readonly statusReason?: unknown;
  readonly toolkit?: {
    readonly slug?: unknown;
  };
  readonly auth_config?: {
    readonly id?: unknown;
  };
  readonly data?: unknown;
  readonly metadata?: unknown;
}

interface ComposioToolResponse {
  readonly slug?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly human_description?: unknown;
  readonly humanDescription?: unknown;
  readonly input_parameters?: unknown;
  readonly inputParameters?: unknown;
  readonly tags?: unknown;
  readonly scopes?: unknown;
  readonly oauth_scopes?: unknown;
  readonly oauthScopes?: unknown;
  readonly auth_scopes?: unknown;
  readonly authScopes?: unknown;
  readonly metadata?: unknown;
  readonly toolkit?: {
    readonly slug?: unknown;
  };
}

interface ComposioToolListResponse {
  readonly items?: unknown;
  readonly data?: unknown;
}

interface ComposioToolExecuteResponse {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly successful?: unknown;
  readonly session_info?: unknown;
  readonly sessionInfo?: unknown;
  readonly log_id?: unknown;
  readonly logId?: unknown;
}

interface ComposioAuthConfigListResponse {
  readonly items?: unknown;
  readonly data?: unknown;
}

interface ComposioAuthConfigResponse {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly toolkit?: {
    readonly slug?: unknown;
  };
  readonly toolkit_slug?: unknown;
  readonly toolkitSlug?: unknown;
}

export interface ComposioConnectorProviderOptions {
  readonly config: ComposioProviderConfig;
  readonly storage: ConnectorStorage;
}

export class ComposioConnectorProvider implements ConnectorProvider {
  private readonly storage: ConnectorStorage;
  private authConfigDiscoveryCache: Partial<Record<ConnectorId, string>> | null = null;
  private authConfigDiscoveryCacheKey: string | null = null;

  constructor(options: ComposioConnectorProviderOptions) {
    void options.config;
    this.storage = options.storage;
  }

  private getProviderConfig(): ComposioProviderConfig {
    return this.storage.getConnectorProviderComposioSettings();
  }

  private async getEffectiveProviderConfig(): Promise<ComposioProviderConfig> {
    const providerConfig = this.getProviderConfig();

    if (!providerConfig.apiKey || hasConfiguredAuthConfigIds(providerConfig.authConfigIds)) {
      return providerConfig;
    }

    const cacheKey = `${providerConfig.baseUrl}|${providerConfig.apiKey}`;
    if (this.authConfigDiscoveryCache && this.authConfigDiscoveryCacheKey === cacheKey) {
      return {
        ...providerConfig,
        authConfigIds: {
          ...this.authConfigDiscoveryCache,
          ...providerConfig.authConfigIds
        }
      };
    }

    const discoveredAuthConfigIds = await discoverComposioAuthConfigIds(providerConfig);
    this.authConfigDiscoveryCache = discoveredAuthConfigIds;
    this.authConfigDiscoveryCacheKey = cacheKey;

    return {
      ...providerConfig,
      authConfigIds: {
        ...discoveredAuthConfigIds,
        ...providerConfig.authConfigIds
      }
    };
  }

  async listConnectors(): Promise<readonly ConnectorCatalogItem[]> {
    return listConnectorCatalog();
  }

  async getConnectionStatus(input: ConnectorConnectionInput): Promise<ConnectorConnectionStatus> {
    const providerConfig = await this.getEffectiveProviderConfig();

    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    if (!providerConfig.apiKey || !providerConfig.authConfigIds[input.connectorId]) {
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
    const providerConfig = await this.getEffectiveProviderConfig();

    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    const authConfigId = providerConfig.authConfigIds[input.connectorId];

    if (!providerConfig.apiKey || !authConfigId) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    this.storage.createConnectorOAuthState({
      stateHash: hashConnectorOAuthState(input.state),
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

  async completeConnection(input: ConnectorCompleteConnectionInput): Promise<ConnectorReconciledConnection> {
    const providerConfig = await this.getEffectiveProviderConfig();

    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    const authConfigId = providerConfig.authConfigIds[input.connectorId];

    if (!providerConfig.apiKey || !authConfigId) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    if (input.callbackStatus && input.callbackStatus.toLowerCase() !== "success") {
      throw createConnectorProviderError("provider_error", { message: "Connector provider did not complete OAuth successfully." });
    }

    const providerConnection = await this.requestConnectedAccount(input.providerConnectionId, input.abortSignal);
    const providerConnectionId = getComposioConnectionId(providerConnection) ?? input.providerConnectionId;
    const providerUserId = getString(providerConnection.user_id) ?? getString(providerConnection.userId);
    const providerAuthConfigId = getString(providerConnection.auth_config?.id);

    if (providerUserId && providerUserId !== input.userId) {
      throw createConnectorProviderError("forbidden", { message: "Connector account belongs to a different user." });
    }

    if (providerAuthConfigId && providerAuthConfigId !== authConfigId) {
      throw createConnectorProviderError("forbidden", { message: "Connector account belongs to a different auth configuration." });
    }

    return mapComposioReconciledConnection(input.connectorId, providerConnectionId, providerConnection);
  }

  async disconnect(input: ConnectorConnectionInput): Promise<void> {
    const providerConfig = await this.getEffectiveProviderConfig();

    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    if (!providerConfig.apiKey || !providerConfig.authConfigIds[input.connectorId]) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const connection = this.storage.getConnectorConnection({
      userId: input.userId,
      connectorId: input.connectorId,
      provider: COMPOSIO_PROVIDER
    });

    if (!connection || connection.status === "disconnected" || !connection.providerConnectionId) {
      return;
    }

    try {
      await this.deleteConnectedAccount(connection.providerConnectionId, input.abortSignal);
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error, {
        fallbackCode: "provider_error",
        message: "Unable to revoke connector account credentials."
      });

      if (normalized.code === "connection_missing" || normalized.statusCode === 404) {
        return;
      }

      throw normalized;
    }
  }

  async listTools(input: ConnectorListToolsInput): Promise<readonly ConnectorToolDefinition[]> {
    const providerConfig = await this.getEffectiveProviderConfig();

    const catalogItems = getCatalogItemsForToolListing(input.connectorId);

    if (!providerConfig.apiKey) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const tools: ConnectorToolDefinition[] = [];

    for (const catalogItem of catalogItems) {
      const authConfigId = providerConfig.authConfigIds[catalogItem.id];

      if (!authConfigId) {
        if (input.connectorId) {
          throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
        }

        continue;
      }

      const connection = this.storage.getConnectorConnection({
        userId: input.userId,
        connectorId: catalogItem.id,
        provider: COMPOSIO_PROVIDER
      });

      if (!connection?.providerConnectionId || connection.status !== "connected") {
        continue;
      }

      tools.push(...(await this.listCuratedToolsForConnector(catalogItem, input.abortSignal)));
    }

    return tools;
  }

  async executeTool(input: ConnectorExecuteToolInput): Promise<ConnectorToolResult> {
    const providerConfig = await this.getEffectiveProviderConfig();

    const allowedTool = getCatalogItemForProviderTool(input.toolId);

    if (!allowedTool) {
      throw createConnectorProviderError("tool_not_found", { message: "Connector tool was not found or is not available." });
    }

    if (!providerConfig.apiKey || !providerConfig.authConfigIds[allowedTool.catalogItem.id]) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const connection = this.storage.getConnectorConnection({
      userId: input.userId,
      connectorId: allowedTool.catalogItem.id,
      provider: COMPOSIO_PROVIDER
    });

    if (!connection || connection.status === "disconnected" || !connection.providerConnectionId) {
      throw createConnectorProviderError("connection_missing");
    }

    if (connection.status === "expired") {
      throw createConnectorProviderError("connection_expired");
    }

    if (connection.status !== "connected") {
      throw createConnectorProviderError("connection_missing");
    }

    if (input.connectionId && input.connectionId !== connection.providerConnectionId) {
      throw createConnectorProviderError("forbidden", { message: "Connector tool cannot run against a different connected account." });
    }

    try {
      const response = await this.executeComposioTool(
        {
          providerToolId: allowedTool.allowedTool.providerToolId,
          userId: input.userId,
          providerConnectionId: connection.providerConnectionId,
          args: input.args
        },
        input.abortSignal
      );

      if (response.successful === false || response.error) {
        const statusCode = getProviderStatusFromErrorPayload(response.error);
        throw createConnectorProviderError(mapComposioExecutionError(response.error), {
          ...(statusCode ? { statusCode } : {})
        });
      }

      const providerExecutionId = getString(response.log_id) ?? getString(response.logId);
      const sessionInfo = getRecord(response.session_info) ?? getRecord(response.sessionInfo);

      return {
        output: response.data,
        ...(providerExecutionId ? { providerExecutionId } : {}),
        ...(sessionInfo ? { metadata: { sessionInfo } } : {})
      };
    } catch (error) {
      throw normalizeConnectorProviderError(error, {
        fallbackCode: isAbortError(error) ? "provider_error" : "provider_error",
        ...(isAbortError(error) ? { message: "Connector tool execution was aborted." } : {})
      });
    }
  }

  private async createConnectedAccount(
    input: { authConfigId: string; userId: string; state: string; redirectUrl?: string },
    abortSignal: AbortSignal | undefined
  ): Promise<ComposioConnectedAccountResponse> {
    return this.requestJson("/api/v3.1/connected_accounts/link", {
      method: "POST",
      body: JSON.stringify({
        auth_config_id: input.authConfigId,
        user_id: input.userId,
        connection_data: {
          state_prefix: input.state
        },
        ...(input.redirectUrl ? { callback_url: appendOAuthStateToCallbackUrl(input.redirectUrl, input.state) } : {})
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

  private async deleteConnectedAccount(connectionId: string, abortSignal: AbortSignal | undefined): Promise<void> {
    await this.request(`/api/v3/connected_accounts/${encodeURIComponent(connectionId)}`, {
      method: "DELETE",
      ...(abortSignal ? { abortSignal } : {})
    });
  }

  private async listCuratedToolsForConnector(
    catalogItem: ConnectorCatalogItem,
    abortSignal: AbortSignal | undefined
  ): Promise<readonly ConnectorToolDefinition[]> {
    const providerTools = await this.requestTools(catalogItem.providerConnectorId, abortSignal);
    const providerToolsById = new Map<string, ComposioToolResponse>();

    for (const providerTool of providerTools) {
      const providerToolId = getString(providerTool.slug);

      if (!providerToolId || providerToolsById.has(providerToolId)) {
        continue;
      }

      providerToolsById.set(providerToolId, providerTool);
    }

    return catalogItem.allowedTools.flatMap((allowedTool) => {
      const providerTool = providerToolsById.get(allowedTool.providerToolId);

      if (!providerTool || !isToolFromToolkit(providerTool, catalogItem.providerConnectorId)) {
        return [];
      }

      return [mapComposioToolDefinition(catalogItem, allowedTool, providerTool)];
    });
  }

  private async requestTools(providerConnectorId: string, abortSignal: AbortSignal | undefined): Promise<readonly ComposioToolResponse[]> {
    const searchParams = new URLSearchParams({ toolkit_slug: providerConnectorId.toLowerCase(), limit: "1000" });
    const response = await this.requestJson<ComposioToolListResponse>(`/api/v3.1/tools?${searchParams.toString()}`, {
      method: "GET",
      ...(abortSignal ? { abortSignal } : {})
    });
    const items = Array.isArray(response.items) ? response.items : Array.isArray(response.data) ? response.data : [];

    return items.filter(isComposioToolResponse);
  }

  private async executeComposioTool(
    input: { providerToolId: string; userId: string; providerConnectionId: string; args: unknown },
    abortSignal: AbortSignal | undefined
  ): Promise<ComposioToolExecuteResponse> {
    return this.requestJson<ComposioToolExecuteResponse>(`/api/v3.1/tools/execute/${encodeURIComponent(input.providerToolId)}`, {
      method: "POST",
      body: JSON.stringify({
        connected_account_id: input.providerConnectionId,
        user_id: input.userId,
        arguments: input.args
      }),
      ...(abortSignal ? { abortSignal } : {})
    });
  }

  private async requestJson<T extends object>(path: string, input: { method: string; body?: string; abortSignal?: AbortSignal }): Promise<T> {
    const response = await this.request(path, input);
    const value = (await response.json()) as unknown;

    if (!value || typeof value !== "object") {
      throw createConnectorProviderError("provider_error", { message: "Connector provider returned an invalid response." });
    }

    return value as T;
  }

  private async request(path: string, input: { method: string; body?: string; abortSignal?: AbortSignal }): Promise<Response> {
    const providerConfig = this.getProviderConfig();

    if (!providerConfig.apiKey) {
      throw createConnectorProviderError("provider_error", { message: "Connector provider is not configured." });
    }

    const signal = combineAbortSignal(input.abortSignal, providerConfig.timeoutMs);
    const response = await fetch(`${providerConfig.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: input.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Monet/0.1 ComposioConnectorProvider",
        "x-api-key": providerConfig.apiKey
      },
      ...(input.body ? { body: input.body } : {}),
      ...(signal ? { signal } : {})
    });

    if (!response.ok) {
      const message = await getComposioErrorMessage(response);
      throw createConnectorProviderError(mapComposioHttpStatus(response.status), {
        ...(message ? { message } : {}),
        statusCode: response.status
      });
    }

    return response;
  }
}

function getCatalogItemsForToolListing(connectorId: ConnectorId | undefined): readonly ConnectorCatalogItem[] {
  if (!connectorId) {
    return listConnectorCatalog();
  }

  const catalogItem = getConnectorCatalogItem(connectorId);

  if (!catalogItem) {
    throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${connectorId}` });
  }

  return [catalogItem];
}

function getCatalogItemForProviderTool(
  providerToolId: string
): { catalogItem: ConnectorCatalogItem; allowedTool: ConnectorAllowedTool } | undefined {
  for (const catalogItem of listConnectorCatalog()) {
    const allowedTool = catalogItem.allowedTools.find((candidate) => candidate.providerToolId === providerToolId);

    if (allowedTool) {
      return { catalogItem, allowedTool };
    }
  }

  return undefined;
}

function hasConfiguredAuthConfigIds(authConfigIds: Partial<Record<ConnectorId, string>>): boolean {
  return listConnectorCatalog().every((catalogItem) => Boolean(authConfigIds[catalogItem.id]));
}

async function discoverComposioAuthConfigIds(providerConfig: ComposioProviderConfig): Promise<Partial<Record<ConnectorId, string>>> {
  if (!providerConfig.apiKey) {
    return {};
  }

  try {
    const signal = combineAbortSignal(undefined, providerConfig.timeoutMs);
    const response = await fetch(`${providerConfig.baseUrl.replace(/\/+$/, "")}/api/v3/auth_configs`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Monet/0.1 ComposioAuthConfigDiscovery",
        "x-api-key": providerConfig.apiKey
      },
      ...(signal ? { signal } : {})
    });

    if (!response.ok) {
      return {};
    }

    const payload = (await response.json()) as ComposioAuthConfigListResponse;
    const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : [];
    const discovered: Partial<Record<ConnectorId, string>> = {};
    const connectorByToolkitSlug = createConnectorByToolkitSlugMap();

    for (const item of items) {
      if (!isComposioAuthConfigResponse(item)) {
        continue;
      }

      const authConfigId = getString(item.id);
      const toolkitSlug = getString(item.toolkit?.slug) ?? getString(item.toolkit_slug) ?? getString(item.toolkitSlug);
      const connectorId = toolkitSlug ? connectorByToolkitSlug.get(normalizeComposioToolkitSlug(toolkitSlug)) : undefined;
      const status = getString(item.status)?.toUpperCase();

      if (!authConfigId || !connectorId || discovered[connectorId] || (status && status !== "ENABLED")) {
        continue;
      }

      discovered[connectorId] = authConfigId;
    }

    return discovered;
  } catch {
    return {};
  }
}

function createConnectorByToolkitSlugMap(): Map<string, ConnectorId> {
  const connectorByToolkitSlug = new Map<string, ConnectorId>();

  for (const connector of listConnectorCatalog()) {
    connectorByToolkitSlug.set(normalizeComposioToolkitSlug(connector.providerConnectorId), connector.id);
    connectorByToolkitSlug.set(normalizeComposioToolkitSlug(connector.id), connector.id);
  }

  connectorByToolkitSlug.set("googledrive", "google_drive");
  connectorByToolkitSlug.set("gdrive", "google_drive");
  connectorByToolkitSlug.set("drive", "google_drive");

  return connectorByToolkitSlug;
}

function isComposioAuthConfigResponse(value: unknown): value is ComposioAuthConfigResponse {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeComposioToolkitSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapComposioToolDefinition(
  catalogItem: ConnectorCatalogItem,
  allowedTool: ConnectorAllowedTool,
  providerTool: ComposioToolResponse
): ConnectorToolDefinition {
  const providerToolId = getString(providerTool.slug) ?? allowedTool.providerToolId;
  const providerDisplayName = getString(providerTool.name);
  const providerDescription = getString(providerTool.description) ?? getString(providerTool.human_description) ?? getString(providerTool.humanDescription);

  return {
    connectorId: catalogItem.id,
    providerToolId,
    name: providerToolId,
    displayName: providerDisplayName ?? allowedTool.displayName,
    description: providerDescription ?? allowedTool.summary,
    inputSchema: getComposioInputSchema(providerTool),
    policy: classifyConnectorToolSafety(getComposioToolSafetyClassificationInput(providerTool, allowedTool))
  };
}

function getComposioToolSafetyClassificationInput(
  providerTool: ComposioToolResponse,
  allowedTool: ConnectorAllowedTool
): {
  safetyHints: readonly string[];
  oauthScopes: readonly string[];
} {
  const metadata = getRecord(providerTool.metadata);
  const rawProviderSafetyHints = uniqueStrings([
    ...getStringArray(providerTool.tags),
    ...getStringArray(metadata?.tags),
    ...getStringArray(metadata?.safety_tags),
    ...getStringArray(metadata?.safetyTags)
  ]);
  const knownProviderSafetyHints = rawProviderSafetyHints.filter((hint) => KNOWN_COMPOSIO_SAFETY_HINTS.has(hint));
  const useCuratedReadHint =
    allowedTool.policy.sideEffect === "read" &&
    !knownProviderSafetyHints.includes("readOnlyHint") &&
    !knownProviderSafetyHints.includes("destructiveHint") &&
    !knownProviderSafetyHints.includes("idempotentHint");
  const providerSafetyHints =
    allowedTool.policy.sideEffect === "read" && (useCuratedReadHint || knownProviderSafetyHints.includes("readOnlyHint"))
      ? knownProviderSafetyHints
      : rawProviderSafetyHints;
  const catalogSafetyHints = useCuratedReadHint ? ["readOnlyHint"] : [];
  return {
    safetyHints: uniqueStrings([
      ...catalogSafetyHints,
      ...providerSafetyHints
    ]),
    oauthScopes: uniqueStrings([
      ...getStringArray(providerTool.scopes),
      ...getStringArray(providerTool.oauth_scopes),
      ...getStringArray(providerTool.oauthScopes),
      ...getStringArray(providerTool.auth_scopes),
      ...getStringArray(providerTool.authScopes),
      ...getStringArray(metadata?.scopes),
      ...getStringArray(metadata?.oauth_scopes),
      ...getStringArray(metadata?.oauthScopes),
      ...getStringArray(metadata?.auth_scopes),
      ...getStringArray(metadata?.authScopes)
    ])
  };
}

function getComposioInputSchema(providerTool: ComposioToolResponse): ConnectorToolJsonSchema {
  const inputParameters = getRecord(providerTool.input_parameters) ?? getRecord(providerTool.inputParameters);

  if (!inputParameters) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false
    };
  }

  return inputParameters as ConnectorToolJsonSchema;
}

function isToolFromToolkit(providerTool: ComposioToolResponse, providerConnectorId: string): boolean {
  const toolkitSlug = getString(providerTool.toolkit?.slug);
  return !toolkitSlug || normalizeComposioToolkitSlug(toolkitSlug) === normalizeComposioToolkitSlug(providerConnectorId);
}

function isComposioToolResponse(value: unknown): value is ComposioToolResponse {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
  const accountLabel = getComposioAccountLabel(providerConnection) ?? connection.accountLabel ?? connection.providerConnectionId ?? undefined;
  const accountId = getComposioAccountId(providerConnection);
  const providerConnectorId = getString(providerConnection.toolkit?.slug);
  const account = {
    ...localStatus.account,
    ...(accountLabel ? { accountLabel } : {}),
    ...(accountId ? { accountId } : {}),
    ...(providerConnectorId ? { providerConnectorId } : {})
  };

  if (providerStatus === "ACTIVE") {
    return {
      ...localStatus,
      account,
      state: "connected",
      connected: true
    };
  }

  if (isDisconnectedComposioStatus(providerStatus)) {
    return {
      ...localStatus,
      account,
      state: "disconnected",
      connected: false
    };
  }

  if (isExpiredComposioStatus(providerStatus)) {
    return {
      ...localStatus,
      account,
      state: "expired",
      connected: false,
      lastErrorCode: "connection_expired",
      lastErrorMessage: "Connector account credentials have expired. Reconnect to continue."
    };
  }

  return {
    ...localStatus,
    account,
    state: providerStatus === "INITIATED" || providerStatus === "INITIALIZING" ? "not_connected" : localStatus.state,
    connected: providerStatus === "INITIATED" || providerStatus === "INITIALIZING" ? false : localStatus.connected
  };
}

function mapComposioReconciledConnection(
  connectorId: ConnectorId,
  providerConnectionId: string,
  providerConnection: ComposioConnectedAccountResponse
): ConnectorReconciledConnection {
  const providerStatus = getString(providerConnection.status)?.toUpperCase();
  const accountId = getComposioAccountId(providerConnection);
  const accountLabel = getComposioAccountLabel(providerConnection);
  const providerConnectorId = getString(providerConnection.toolkit?.slug);
  const authConfigId = getString(providerConnection.auth_config?.id);
  const now = new Date().toISOString();
  const providerMetadataJson = JSON.stringify({
    providerStatus: providerStatus ?? "UNKNOWN",
    ...(accountId ? { accountId } : {}),
    ...(providerConnectorId ? { providerConnectorId } : {}),
    ...(authConfigId ? { authConfigId } : {})
  });

  if (providerStatus === "ACTIVE") {
    return {
      connectorId,
      state: "connected",
      connected: true,
      providerConnectionId,
      account: {
        ...(accountLabel ? { accountLabel } : {}),
        ...(accountId ? { accountId } : {}),
        providerConnectionId,
        ...(providerConnectorId ? { providerConnectorId } : {}),
        connectedAt: now,
        updatedAt: now
      },
      persistence: {
        status: "connected",
        providerConnectionId,
        providerMetadataJson,
        accountLabel: accountLabel ?? null,
        lastConnectedAt: now,
        lastError: null
      }
    };
  }

  const disconnected = isDisconnectedComposioStatus(providerStatus);
  const expired = isExpiredComposioStatus(providerStatus);
  const lastErrorCode: ConnectorProviderErrorCode | undefined = disconnected ? undefined : expired ? "connection_expired" : "provider_error";
  const lastErrorMessage = expired
    ? "Connector account credentials have expired. Reconnect to continue."
    : disconnected
      ? "Connector account has been disconnected."
      : "Connector account authorization has not completed yet.";

  return {
    connectorId,
    state: disconnected ? "disconnected" : expired ? "expired" : "not_connected",
    connected: false,
    providerConnectionId,
    account: {
      ...(accountLabel ? { accountLabel } : {}),
      ...(accountId ? { accountId } : {}),
      providerConnectionId,
      ...(providerConnectorId ? { providerConnectorId } : {}),
      updatedAt: now
    },
    persistence: {
      status: disconnected ? "disconnected" : expired ? "expired" : "disconnected",
      providerConnectionId,
      providerMetadataJson,
      accountLabel: accountLabel ?? null,
      lastConnectedAt: null,
      lastError: lastErrorCode ? JSON.stringify({ code: lastErrorCode, message: lastErrorMessage }) : null
    },
    ...(lastErrorCode ? { lastErrorCode } : {}),
    lastErrorMessage
  };
}

function isExpiredComposioStatus(status: string | undefined): boolean {
  return status === "EXPIRED" || status === "FAILED" || status === "DISABLED" || status === "INACTIVE";
}

function isDisconnectedComposioStatus(status: string | undefined): boolean {
  return status === "REVOKED" || status === "DELETED" || status === "DISCONNECTED";
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
  return getString(response.id) ?? getString(response.nanoid) ?? getString(response.connected_account_id) ?? getString(response.connectedAccountId);
}

function appendOAuthStateToCallbackUrl(callbackUrl: string, state: string): string {
  try {
    const url = new URL(callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  } catch {
    const separator = callbackUrl.includes("?") ? "&" : "?";
    return `${callbackUrl}${separator}state=${encodeURIComponent(state)}`;
  }
}

function getComposioAccountId(response: ComposioConnectedAccountResponse): string | undefined {
  const data = getRecord(response.data);
  const metadata = getRecord(response.metadata);

  return (
    getString(response.account_id) ??
    getString(response.accountId) ??
    getString(data?.account_id) ??
    getString(data?.accountId) ??
    getString(metadata?.account_id) ??
    getString(metadata?.accountId)
  );
}

function getComposioAccountLabel(response: ComposioConnectedAccountResponse): string | undefined {
  const data = getRecord(response.data);
  const metadata = getRecord(response.metadata);

  return (
    getString(response.account_label) ??
    getString(response.accountLabel) ??
    getString(response.email) ??
    getString(response.name) ??
    getString(data?.account_label) ??
    getString(data?.accountLabel) ??
    getString(data?.email) ??
    getString(data?.name) ??
    getString(metadata?.account_label) ??
    getString(metadata?.accountLabel) ??
    getString(metadata?.email) ??
    getString(metadata?.name) ??
    getComposioConnectionId(response)
  );
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const stringValue = getString(item);
      return stringValue ? [stringValue] : [];
    });
  }

  const stringValue = getString(value);
  return stringValue ? [stringValue] : [];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function mapComposioHttpStatus(status: number): ConnectorProviderErrorCode {
  if (status === 400 || status === 422) {
    return "invalid_arguments";
  }

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

async function getComposioErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const rawBody = await response.text();

    if (!rawBody.trim()) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(rawBody) as unknown;
      const record = getRecord(parsed);
      const message = getString(record?.message) ?? getString(record?.error) ?? getString(record?.detail);
      const suggestedFix = getString(record?.suggested_fix) ?? getString(record?.suggestedFix);
      const errors = Array.isArray(record?.errors) ? record.errors.filter((value): value is string => typeof value === "string") : [];
      const details = [message, suggestedFix, ...errors].filter((value): value is string => Boolean(value && value.trim()));

      return details.length ? `Connector provider request failed: ${details.join(" ")}` : undefined;
    } catch {
      return rawBody.length <= 500 ? `Connector provider request failed: ${rawBody}` : undefined;
    }
  } catch {
    return undefined;
  }
}

function mapComposioExecutionError(error: unknown): ConnectorProviderErrorCode {
  const record = getRecord(error);
  const statusCode = getProviderStatusFromErrorPayload(error);
  const code = getString(record?.code) ?? getString(record?.type) ?? getString(record?.error_code) ?? getString(record?.errorCode);
  const normalizedCode = code?.toLowerCase();

  if (normalizedCode) {
    if (normalizedCode.includes("rate") || normalizedCode.includes("throttle")) {
      return "rate_limited";
    }

    if (normalizedCode.includes("argument") || normalizedCode.includes("validation") || normalizedCode.includes("invalid")) {
      return "invalid_arguments";
    }

    if (normalizedCode.includes("auth") || normalizedCode.includes("credential") || normalizedCode.includes("expired")) {
      return "connection_expired";
    }

    if (normalizedCode.includes("forbidden") || normalizedCode.includes("permission")) {
      return "forbidden";
    }

    if (normalizedCode.includes("not_found") || normalizedCode.includes("not found")) {
      return "tool_not_found";
    }
  }

  if (statusCode) {
    return mapComposioHttpStatus(statusCode);
  }

  return "provider_error";
}

function getProviderStatusFromErrorPayload(error: unknown): number | undefined {
  const record = getRecord(error);

  if (!record) {
    return undefined;
  }

  const candidates = [record.statusCode, record.status, record.http_status, record.httpStatus];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }

  return undefined;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      ((error as { readonly name?: unknown }).name === "AbortError" || (error as { readonly name?: unknown }).name === "TimeoutError")
  );
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
