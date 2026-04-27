import { getConnectorCatalogItem, listConnectorCatalog, type ConnectorAllowedTool, type ConnectorCatalogItem, type ConnectorId } from "./catalog";
import { createConnectorProviderError, normalizeConnectorProviderError, type ConnectorProviderErrorCode } from "./errors";
import type { ConnectorConnectionStatus, ConnectorConnectionState, ConnectorProvider } from "./provider";

export type ConnectorServiceStatus = "unavailable" | "not_connected" | "connected" | "expired";

export interface ConnectorServiceConnection {
  readonly status: ConnectorServiceStatus;
  readonly connected: boolean;
  readonly connectedAccountLabel?: string;
  readonly account?: ConnectorConnectionStatus["account"];
  readonly lastErrorCode?: ConnectorProviderErrorCode;
  readonly lastErrorMessage?: string;
}

export interface ConnectorCatalogCard {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly description: string;
  readonly category: ConnectorCatalogItem["category"];
  readonly icon: string;
  readonly featuredTools: readonly string[];
  readonly enabledByDefault: boolean;
  readonly minimumApprovalPolicy: ConnectorCatalogItem["minimumApprovalPolicy"];
  readonly capabilitySummaries: readonly string[];
  readonly status: ConnectorServiceStatus;
  readonly connectedAccountLabel?: string;
  readonly lastErrorCode?: ConnectorProviderErrorCode;
  readonly lastErrorMessage?: string;
}

export interface ConnectorDetail extends ConnectorCatalogCard {
  readonly providerConnectorId: string;
  readonly connection: ConnectorServiceConnection;
  readonly allowedTools: readonly ConnectorAllowedTool[];
}

export interface ConnectorServiceInput {
  readonly userId: string;
  readonly abortSignal?: AbortSignal;
}

export interface ConnectorServiceGetInput extends ConnectorServiceInput {
  readonly connectorId: string;
}

export interface ConnectorService {
  listConnectors(input: ConnectorServiceInput): Promise<readonly ConnectorCatalogCard[]>;
  getConnector(input: ConnectorServiceGetInput): Promise<ConnectorDetail>;
  getConnection(input: ConnectorServiceGetInput): Promise<ConnectorServiceConnection>;
}

export interface CreateConnectorServiceOptions {
  readonly provider: ConnectorProvider;
}

export function createConnectorService(options: CreateConnectorServiceOptions): ConnectorService {
  return new DefaultConnectorService(options.provider);
}

class DefaultConnectorService implements ConnectorService {
  constructor(private readonly provider: ConnectorProvider) {}

  async listConnectors(input: ConnectorServiceInput): Promise<readonly ConnectorCatalogCard[]> {
    const catalog = listConnectorCatalog();
    return Promise.all(
      catalog.map(async (connector) => {
        const connection = await this.getCatalogConnection(connector, input);
        return toCatalogCard(connector, connection);
      })
    );
  }

  async getConnector(input: ConnectorServiceGetInput): Promise<ConnectorDetail> {
    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    const connection = await this.getCatalogConnection(catalogItem, input);

    return {
      ...toCatalogCard(catalogItem, connection),
      providerConnectorId: catalogItem.providerConnectorId,
      connection,
      allowedTools: catalogItem.allowedTools
    };
  }

  async getConnection(input: ConnectorServiceGetInput): Promise<ConnectorServiceConnection> {
    const catalogItem = getConnectorCatalogItem(input.connectorId);

    if (!catalogItem) {
      throw createConnectorProviderError("tool_not_found", { message: `Unknown connector: ${input.connectorId}` });
    }

    return this.getCatalogConnection(catalogItem, input);
  }

  private async getCatalogConnection(
    catalogItem: ConnectorCatalogItem,
    input: ConnectorServiceInput
  ): Promise<ConnectorServiceConnection> {
    if (!catalogItem.enabledByDefault) {
      return {
        status: "unavailable",
        connected: false,
        lastErrorCode: "provider_error",
        lastErrorMessage: "Connector is not enabled."
      };
    }

    try {
      const providerStatus = await this.provider.getConnectionStatus({
        userId: input.userId,
        connectorId: catalogItem.id,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {})
      });

      return normalizeProviderStatus(providerStatus);
    } catch (error) {
      const normalized = normalizeConnectorProviderError(error, {
        fallbackCode: "provider_error",
        message: "Unable to load connector connection status."
      });

      return normalizeProviderError(normalized.code, normalized.message);
    }
  }
}

function toCatalogCard(catalogItem: ConnectorCatalogItem, connection: ConnectorServiceConnection): ConnectorCatalogCard {
  return {
    id: catalogItem.id,
    displayName: catalogItem.displayName,
    description: catalogItem.description,
    category: catalogItem.category,
    icon: catalogItem.icon,
    featuredTools: catalogItem.featuredTools,
    enabledByDefault: catalogItem.enabledByDefault,
    minimumApprovalPolicy: catalogItem.minimumApprovalPolicy,
    capabilitySummaries: catalogItem.capabilitySummaries,
    status: connection.status,
    ...(connection.connectedAccountLabel ? { connectedAccountLabel: connection.connectedAccountLabel } : {}),
    ...(connection.lastErrorCode ? { lastErrorCode: connection.lastErrorCode } : {}),
    ...(connection.lastErrorMessage ? { lastErrorMessage: connection.lastErrorMessage } : {})
  };
}

export function normalizeProviderStatus(status: ConnectorConnectionStatus): ConnectorServiceConnection {
  const normalizedStatus = normalizeConnectionState(status.state, status.connected, status.lastErrorCode);
  const connected = normalizedStatus === "connected";

  return {
    status: normalizedStatus,
    connected,
    ...(status.account?.accountLabel ? { connectedAccountLabel: status.account.accountLabel } : {}),
    ...(status.account ? { account: status.account } : {}),
    ...(status.lastErrorCode ? { lastErrorCode: status.lastErrorCode } : {}),
    ...(status.lastErrorMessage ? { lastErrorMessage: status.lastErrorMessage } : {})
  };
}

export function normalizeConnectionState(
  state: ConnectorConnectionState,
  connected: boolean,
  lastErrorCode?: ConnectorProviderErrorCode
): ConnectorServiceStatus {
  if (connected || state === "connected") {
    return "connected";
  }

  if (state === "expired" || lastErrorCode === "connection_expired") {
    return "expired";
  }

  if (state === "unavailable") {
    return "unavailable";
  }

  return "not_connected";
}

function normalizeProviderError(code: ConnectorProviderErrorCode, message: string): ConnectorServiceConnection {
  if (code === "connection_expired") {
    return {
      status: "expired",
      connected: false,
      lastErrorCode: code,
      lastErrorMessage: message
    };
  }

  if (code === "connection_missing") {
    return {
      status: "not_connected",
      connected: false,
      lastErrorCode: code,
      lastErrorMessage: message
    };
  }

  return {
    status: "unavailable",
    connected: false,
    lastErrorCode: code,
    lastErrorMessage: message
  };
}
