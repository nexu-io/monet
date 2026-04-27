import { sql } from "drizzle-orm";
import {
  createMonetId,
  idPrefixes,
  type ConnectorConnectionId,
  type ConnectorConnectionStatus
} from "@monet/shared";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const connectorConnections = sqliteTable(
  "connector_connections",
  {
    id: text("id")
      .$type<ConnectorConnectionId>()
      .$defaultFn(() => createMonetId(idPrefixes.connectorConnection))
      .primaryKey(),
    userId: text("user_id").notNull(),
    connectorId: text("connector_id").notNull(),
    provider: text("provider").notNull(),
    providerConnectionId: text("provider_connection_id"),
    providerMetadataJson: text("provider_metadata_json"),
    accountLabel: text("account_label"),
    status: text("status").$type<ConnectorConnectionStatus>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastConnectedAt: text("last_connected_at"),
    lastError: text("last_error")
  },
  (table) => [
    uniqueIndex("connector_connections_user_connector_provider_unique").on(table.userId, table.connectorId, table.provider),
    index("idx_connector_connections_user_id").on(table.userId),
    index("idx_connector_connections_connector_id").on(table.connectorId),
    index("idx_connector_connections_provider_connection_id").on(table.providerConnectionId),
    index("idx_connector_connections_status").on(table.status),
    check(
      "connector_connections_no_provider_metadata_secrets",
      sql`${table.providerMetadataJson} IS NULL OR (
        instr(lower(${table.providerMetadataJson}), 'access_token') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'accesstoken') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'refresh_token') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'refreshtoken') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'oauth_token') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'oauthtoken') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'api_key') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'apikey') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'x-api-key') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'xapikey') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'authorization') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'bearer ') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'client_secret') = 0 AND
        instr(lower(${table.providerMetadataJson}), 'clientsecret') = 0
      )`
    ),
    check(
      "connector_connections_no_last_error_secrets",
      sql`${table.lastError} IS NULL OR (
        instr(lower(${table.lastError}), 'access_token') = 0 AND
        instr(lower(${table.lastError}), 'accesstoken') = 0 AND
        instr(lower(${table.lastError}), 'refresh_token') = 0 AND
        instr(lower(${table.lastError}), 'refreshtoken') = 0 AND
        instr(lower(${table.lastError}), 'oauth_token') = 0 AND
        instr(lower(${table.lastError}), 'oauthtoken') = 0 AND
        instr(lower(${table.lastError}), 'api_key') = 0 AND
        instr(lower(${table.lastError}), 'apikey') = 0 AND
        instr(lower(${table.lastError}), 'x-api-key') = 0 AND
        instr(lower(${table.lastError}), 'xapikey') = 0 AND
        instr(lower(${table.lastError}), 'authorization') = 0 AND
        instr(lower(${table.lastError}), 'bearer ') = 0 AND
        instr(lower(${table.lastError}), 'client_secret') = 0 AND
        instr(lower(${table.lastError}), 'clientsecret') = 0
      )`
    )
  ]
);
