import { createMonetId, idPrefixes, type ProviderId, type ProviderModelId, type SessionId } from "@monet/shared";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { providerModels } from "./provider-models";
import { providers } from "./providers";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").$type<SessionId>().$defaultFn(() => createMonetId(idPrefixes.session)).primaryKey(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
    defaultProviderId: text("default_provider_id")
      .$type<ProviderId | null>()
      .references(() => providers.id, { onDelete: "set null" }),
    defaultModelId: text("default_model_id")
      .$type<ProviderModelId | null>()
      .references(() => providerModels.id, { onDelete: "set null" })
  },
  (table) => [
    index("idx_sessions_updated_at").on(table.updatedAt),
    index("idx_sessions_archived_at").on(table.archivedAt)
  ]
);
