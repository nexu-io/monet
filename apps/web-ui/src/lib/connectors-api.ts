import { getMonetClientConfig } from "./monet-client";

export type ConnectorId = "github" | "notion" | "google_drive";

export type ConnectorCategory = "developer" | "productivity" | "files";

export type ConnectorStatus = "unavailable" | "not_connected" | "connected" | "expired";

export type ConnectorToolSideEffect = "read" | "write" | "destructive" | "external_send";

export type ConnectorToolApproval = "never" | "first_use" | "always";

export type ConnectorProviderErrorCode =
  | "connection_missing"
  | "connection_expired"
  | "rate_limited"
  | "upstream_unavailable"
  | "invalid_arguments"
  | "forbidden"
  | "tool_not_found"
  | "provider_error";

export interface ConnectorToolPolicy {
  readonly sideEffect: ConnectorToolSideEffect;
  readonly approval: ConnectorToolApproval;
}

export interface ConnectorCatalogCard {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly description: string;
  readonly category: ConnectorCategory;
  readonly icon: string;
  readonly featuredTools: string[];
  readonly enabledByDefault: boolean;
  readonly minimumApprovalPolicy: ConnectorToolPolicy;
  readonly capabilitySummaries: string[];
  readonly status: ConnectorStatus;
  readonly connectedAccountLabel?: string;
  readonly lastErrorCode?: ConnectorProviderErrorCode;
  readonly lastErrorMessage?: string;
}

export interface ConnectorAccountMetadata {
  readonly accountLabel?: string;
  readonly accountId?: string;
  readonly providerConnectionId?: string;
  readonly providerConnectorId?: string;
  readonly connectedAt?: string;
  readonly updatedAt?: string;
}

export interface ConnectorServiceConnection {
  readonly status: ConnectorStatus;
  readonly connected: boolean;
  readonly connectedAccountLabel?: string;
  readonly account?: ConnectorAccountMetadata;
  readonly lastErrorCode?: ConnectorProviderErrorCode;
  readonly lastErrorMessage?: string;
}

export interface ConnectorAllowedTool {
  readonly providerToolId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly policy: ConnectorToolPolicy;
}

export interface ConnectorDetail extends ConnectorCatalogCard {
  readonly providerConnectorId: string;
  readonly connection: ConnectorServiceConnection;
  readonly allowedTools: ConnectorAllowedTool[];
}

export interface ListConnectorsResponse {
  readonly connectors: ConnectorCatalogCard[];
}

export interface ListConnectorsOptions {
  readonly force?: boolean;
}

export interface GetConnectorResponse {
  readonly connector: ConnectorDetail;
}

export interface StartConnectorConnectionInput {
  readonly redirectUrl?: string;
}

export interface StartConnectorConnectionResponse {
  readonly status: "redirect_required" | "connected" | "pending";
  readonly connectorId: ConnectorId;
  readonly providerConnectionId?: string;
  readonly redirectUrl?: string;
  readonly expiresAt?: string;
}

export interface DisconnectConnectorConnectionResponse {
  readonly connectorId: ConnectorId;
  readonly status: "not_connected";
}

interface ErrorResponse {
  readonly message?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const config = getMonetClientConfig();
  const headers = new Headers(init?.headers);

  if (config.bearerToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${config.bearerToken}`);
  }

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    credentials: "omit",
    headers
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const error = (await response.json()) as ErrorResponse;

      if (typeof error.message === "string" && error.message.trim()) {
        message = error.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

let listConnectorsInFlight: Promise<ListConnectorsResponse> | null = null;
let listConnectorsCachedResponse: { readonly response: ListConnectorsResponse; readonly expiresAt: number } | null = null;
const listConnectorsDedupeCacheMs = 1_000;

export async function listConnectors(options: ListConnectorsOptions = {}) {
  if (!options.force) {
    if (listConnectorsInFlight) {
      return listConnectorsInFlight;
    }

    if (listConnectorsCachedResponse && Date.now() < listConnectorsCachedResponse.expiresAt) {
      return listConnectorsCachedResponse.response;
    }
  }

  const request = requestJson<ListConnectorsResponse>("/api/connectors");
  listConnectorsInFlight = request;

  try {
    const response = await request;
    listConnectorsCachedResponse = {
      response,
      expiresAt: Date.now() + listConnectorsDedupeCacheMs
    };
    return response;
  } finally {
    if (listConnectorsInFlight === request) {
      listConnectorsInFlight = null;
    }
  }
}

export async function getConnector(connectorId: ConnectorId) {
  return requestJson<GetConnectorResponse>(`/api/connectors/${encodeURIComponent(connectorId)}`);
}

export async function startConnectorConnection(connectorId: ConnectorId, input?: StartConnectorConnectionInput) {
  return requestJson<StartConnectorConnectionResponse>(`/api/connectors/${encodeURIComponent(connectorId)}/connect`, {
    method: "POST",
    ...(input ? { body: JSON.stringify(input) } : {})
  });
}

export async function disconnectConnector(connectorId: ConnectorId) {
  return requestJson<DisconnectConnectorConnectionResponse>(`/api/connectors/${encodeURIComponent(connectorId)}/connection`, {
    method: "DELETE"
  });
}
