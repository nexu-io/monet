import { createMonetId, idPrefixes, type MessageId, type MessageRole, type RunId, type SessionId } from "@monet/shared";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { runs } from "./runs";
import { sessions } from "./sessions";

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").$type<MessageId>().$defaultFn(() => createMonetId(idPrefixes.message)).primaryKey(),
    sessionId: text("session_id")
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    runId: text("run_id").$type<RunId | null>().references(() => runs.id, { onDelete: "set null" }),
    role: text("role").$type<MessageRole>().notNull(),
    uiMessageJson: text("ui_message_json").notNull(),
    uiMessageSchemaVersion: text("ui_message_schema_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("messages_session_id_idempotency_key_unique").on(table.sessionId, table.idempotencyKey),
    index("idx_messages_session_id_created_at").on(table.sessionId, table.createdAt),
    index("idx_messages_session_id_idempotency").on(table.sessionId, table.idempotencyKey),
    index("idx_messages_run_id").on(table.runId)
  ]
);
