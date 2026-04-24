import {
  createMonetId,
  idPrefixes,
  type ProviderId,
  type ProviderModelId,
  type RunId,
  type RunStatus,
  type SessionId
} from "@monet/shared";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { providerModels } from "./provider-models";
import { providers } from "./providers";
import { sessions } from "./sessions";

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").$type<RunId>().$defaultFn(() => createMonetId(idPrefixes.run)).primaryKey(),
    sessionId: text("session_id")
      .$type<SessionId>()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull(),
    providerId: text("provider_id")
      .$type<ProviderId>()
      .notNull()
      .references(() => providers.id),
    modelId: text("model_id")
      .$type<ProviderModelId>()
      .notNull()
      .references(() => providerModels.id),
    currentStep: integer("current_step").notNull().default(0),
    consumedTokens: integer("consumed_tokens").notNull().default(0),
    consumedToolCalls: integer("consumed_tool_calls").notNull().default(0),
    maxSteps: integer("max_steps").notNull(),
    maxTokensPerRun: integer("max_tokens_per_run"),
    wallClockDeadlineAt: text("wall_clock_deadline_at"),
    finishReason: text("finish_reason"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at")
  },
  (table) => [
    index("idx_runs_session_id_started_at").on(table.sessionId, table.startedAt),
    index("idx_runs_status").on(table.status)
  ]
);
