import {
  createMonetId,
  idPrefixes,
  type ConnectorConnectionId,
  type ConnectorConnectionStatus
} from "@monet/shared";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    index("idx_connector_connections_status").on(table.status)
  ]
);
