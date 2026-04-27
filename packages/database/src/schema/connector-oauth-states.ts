import { createMonetId, idPrefixes, type ConnectorOAuthStateId } from "@monet/shared";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const connectorOauthStates = sqliteTable(
  "connector_oauth_states",
  {
    id: text("id")
      .$type<ConnectorOAuthStateId>()
      .$defaultFn(() => createMonetId(idPrefixes.connectorOAuthState))
      .primaryKey(),
    stateHash: text("state_hash").notNull(),
    userId: text("user_id").notNull(),
    connectorId: text("connector_id").notNull(),
    provider: text("provider").notNull(),
    redirectUrl: text("redirect_url"),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("connector_oauth_states_state_hash_unique").on(table.stateHash),
    index("idx_connector_oauth_states_user_connector_provider").on(table.userId, table.connectorId, table.provider),
    index("idx_connector_oauth_states_expires_at").on(table.expiresAt),
    index("idx_connector_oauth_states_consumed_at").on(table.consumedAt)
  ]
);
