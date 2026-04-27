import {
  createMonetId,
  idPrefixes,
  type RunId,
  type ToolApprovalDecision,
  type ToolCallId,
  type ToolCallStatus
} from "@monet/shared";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { runs } from "./runs";

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").$type<ToolCallId>().$defaultFn(() => createMonetId(idPrefixes.toolCall)).primaryKey(),
    runId: text("run_id")
      .$type<RunId>()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json"),
    outputTruncated: integer("output_truncated", { mode: "boolean" }).notNull().default(false),
    outputSizeBytes: integer("output_size_bytes"),
    approvalDecision: text("approval_decision").$type<ToolApprovalDecision | null>(),
    approvalDecidedAt: text("approval_decided_at"),
    confirmationTokenHash: text("confirmation_token_hash"),
    connectorId: text("connector_id"),
    connectorName: text("connector_name"),
    connectorAccountLabel: text("connector_account_label"),
    connectorToolName: text("connector_tool_name"),
    connectorProviderToolId: text("connector_provider_tool_id"),
    connectorArgumentsSummary: text("connector_arguments_summary"),
    connectorApprovalPolicyJson: text("connector_approval_policy_json"),
    status: text("status").$type<ToolCallStatus>().notNull(),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at")
  },
  (table) => [
    index("idx_tool_calls_run_id_started_at").on(table.runId, table.startedAt),
    index("idx_tool_calls_status").on(table.status)
  ]
);
