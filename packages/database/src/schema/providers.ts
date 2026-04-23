import type { ProviderId, ProviderType } from "@monet/shared";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").$type<ProviderId>().primaryKey(),
    type: text("type").$type<ProviderType>().notNull(),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url"),
    defaultModelName: text("default_model_name"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    timeoutMs: integer("timeout_ms"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("idx_providers_type").on(table.type), index("idx_providers_enabled").on(table.enabled)]
);
