import { sql } from "drizzle-orm";
import { createMonetId, idPrefixes, type ConnectorOAuthStateId } from "@monet/shared";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    index("idx_connector_oauth_states_consumed_at").on(table.consumedAt),
    check(
      "connector_oauth_states_no_redirect_url_secrets",
      sql`${table.redirectUrl} IS NULL OR (
        instr(lower(${table.redirectUrl}), 'access_token') = 0 AND
        instr(lower(${table.redirectUrl}), 'accesstoken') = 0 AND
        instr(lower(${table.redirectUrl}), 'refresh_token') = 0 AND
        instr(lower(${table.redirectUrl}), 'refreshtoken') = 0 AND
        instr(lower(${table.redirectUrl}), 'oauth_token') = 0 AND
        instr(lower(${table.redirectUrl}), 'oauthtoken') = 0 AND
        instr(lower(${table.redirectUrl}), 'api_key') = 0 AND
        instr(lower(${table.redirectUrl}), 'apikey') = 0 AND
        instr(lower(${table.redirectUrl}), 'x-api-key') = 0 AND
        instr(lower(${table.redirectUrl}), 'xapikey') = 0 AND
        instr(lower(${table.redirectUrl}), 'authorization') = 0 AND
        instr(lower(${table.redirectUrl}), 'bearer ') = 0 AND
        instr(lower(${table.redirectUrl}), 'client_secret') = 0 AND
        instr(lower(${table.redirectUrl}), 'clientsecret') = 0
      )`
    )
  ]
);
