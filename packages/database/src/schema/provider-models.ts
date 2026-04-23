import { createMonetId, idPrefixes, type ProviderId, type ProviderModelId } from "@monet/shared";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { providers } from "./providers";

export const providerModels = sqliteTable(
  "provider_models",
  {
    id: text("id").$type<ProviderModelId>().$defaultFn(() => createMonetId(idPrefixes.providerModel)).primaryKey(),
    providerId: text("provider_id")
      .$type<ProviderId>()
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelName: text("model_name").notNull(),
    displayName: text("display_name").notNull(),
    supportsTools: integer("supports_tools", { mode: "boolean" }).notNull().default(false),
    supportsReasoning: integer("supports_reasoning", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    capabilitiesJson: text("capabilities_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("provider_models_provider_id_model_name_unique").on(table.providerId, table.modelName),
    index("idx_provider_models_provider_id").on(table.providerId),
    index("idx_provider_models_enabled").on(table.enabled)
  ]
);
