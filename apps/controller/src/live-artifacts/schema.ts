import { z } from "@hono/zod-openapi";

export const LIVE_ARTIFACT_SCHEMA_VERSION = 1;

export const LIVE_ARTIFACT_LIMITS = {
  id: 128,
  title: 160,
  slug: 180,
  description: 1_000,
  error: 1_000,
  toolName: 200,
  connectorId: 100,
  connectorName: 120,
  accountLabel: 200,
  providerToolId: 200,
  markdown: 20_000,
  metricLabel: 120,
  metricValue: 200,
  metricCaption: 500,
  listItems: 100,
  listItemTitle: 300,
  listItemSubtitle: 700,
  tableColumns: 30,
  tableRows: 200,
  tableCell: 1_000,
  url: 2_000,
  jsonDepth: 8,
  jsonArrayItems: 200,
  jsonObjectKeys: 100,
  sourceInputBytes: 16_000,
  renderJsonBytes: 64_000,
  sourceJsonBytes: 32_000
} as const;

const idSchema = z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id);
const nullableIdSchema = idSchema.nullable();
const isoDateTimeSchema = z.string().datetime();
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
const optionalBoundedString = (max: number) => z.string().trim().min(1).max(max).optional();
const nullableBoundedString = (max: number) => z.string().trim().min(1).max(max).nullable();

const htmlLikePattern = /<\s*\/?\s*(?:!doctype|html|head|body|script|iframe|object|embed|link|meta|style|svg|math|form|input|button|textarea|select|option|video|audio|source|canvas|img|a|div|span|p|table|tr|td|th|ul|ol|li|h[1-6]|br|hr)\b[^>]*>/i;
const scriptLikePattern = /(?:javascript\s*:|on[a-z]+\s*=|<\s*script\b|<\s*\/\s*script\s*>)/i;

export const LiveArtifactStatusSchema = z.enum(["draft", "active", "archived"]);
export const LiveArtifactRefreshStatusSchema = z.enum(["idle", "refreshing", "failed"]);
export const LiveArtifactTileKindSchema = z.enum(["markdown", "metric", "list", "table", "link_card", "json"]);
export const LiveArtifactTileSourceTypeSchema = z.enum(["tool", "connector_tool"]);
export const LiveArtifactRefreshPermissionSchema = z.enum([
  "manual_refresh_granted_for_read_only",
  "requires_confirmation"
]);

export const LiveArtifactSafeTextSchema = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !scriptLikePattern.test(value), "Script-like content is not allowed")
    .refine((value) => !htmlLikePattern.test(value), "Raw HTML content is not allowed");

export const LiveArtifactSafeUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIVE_ARTIFACT_LIMITS.url)
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Only http and https URLs are allowed");

export type LiveArtifactJsonValue =
  | string
  | number
  | boolean
  | null
  | LiveArtifactJsonValue[]
  | { [key: string]: LiveArtifactJsonValue };

const jsonValueSchema: z.ZodType<LiveArtifactJsonValue> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

function getJsonDepth(value: LiveArtifactJsonValue): number {
  if (value === null || typeof value !== "object") {
    return 0;
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  if (children.length === 0) {
    return 1;
  }

  return 1 + Math.max(...children.map(getJsonDepth));
}

function addJsonShapeIssues(value: LiveArtifactJsonValue, ctx: z.RefinementCtx, path: Array<string | number> = []): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > LIVE_ARTIFACT_LIMITS.jsonArrayItems) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: LIVE_ARTIFACT_LIMITS.jsonArrayItems,
        type: "array",
        inclusive: true,
        path,
        message: "JSON arrays are too large"
      });
    }
    value.forEach((item, index) => addJsonShapeIssues(item, ctx, [...path, index]));
    return;
  }

  const entries = Object.entries(value);
  if (entries.length > LIVE_ARTIFACT_LIMITS.jsonObjectKeys) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "JSON objects have too many keys"
    });
  }

  for (const [key, child] of entries) {
    addJsonShapeIssues(child, ctx, [...path, key]);
  }
}

export const LiveArtifactJsonValueSchema = jsonValueSchema.superRefine((value, ctx) => {
  if (getJsonDepth(value) > LIVE_ARTIFACT_LIMITS.jsonDepth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `JSON value exceeds max depth of ${LIVE_ARTIFACT_LIMITS.jsonDepth}`
    });
  }
  addJsonShapeIssues(value, ctx);
});

const jsonObjectSchema = z.record(LiveArtifactJsonValueSchema);

export const LiveArtifactMarkdownRenderJsonSchema = z.object({
  kind: z.literal("markdown"),
  markdown: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.markdown)
});

export const LiveArtifactMetricRenderJsonSchema = z.object({
  kind: z.literal("metric"),
  label: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.metricLabel, 1),
  value: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.metricValue, 1),
  caption: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.metricCaption).optional(),
  trend: z.enum(["up", "down", "flat"]).optional()
});

export const LiveArtifactListItemSchema = z.object({
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.listItemTitle, 1),
  subtitle: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.listItemSubtitle).optional(),
  url: LiveArtifactSafeUrlSchema.optional()
});

export const LiveArtifactListRenderJsonSchema = z.object({
  kind: z.literal("list"),
  items: z.array(LiveArtifactListItemSchema).max(LIVE_ARTIFACT_LIMITS.listItems)
});

const tableCellSchema = LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.tableCell);

export const LiveArtifactTableRenderJsonSchema = z
  .object({
    kind: z.literal("table"),
    columns: z.array(LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.tableCell, 1)).min(1).max(LIVE_ARTIFACT_LIMITS.tableColumns),
    rows: z.array(z.array(tableCellSchema).max(LIVE_ARTIFACT_LIMITS.tableColumns)).max(LIVE_ARTIFACT_LIMITS.tableRows)
  })
  .superRefine((value, ctx) => {
    for (const [rowIndex, row] of value.rows.entries()) {
      if (row.length !== value.columns.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", rowIndex],
          message: "Table row cell count must match columns"
        });
      }
    }
  });

export const LiveArtifactLinkCardRenderJsonSchema = z.object({
  kind: z.literal("link_card"),
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
  url: LiveArtifactSafeUrlSchema,
  description: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.description).optional(),
  sourceLabel: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.connectorName).optional()
});

export const LiveArtifactJsonRenderJsonSchema = z.object({
  kind: z.literal("json"),
  value: LiveArtifactJsonValueSchema
});

export const LiveArtifactRenderJsonSchema = z.union([
  LiveArtifactMarkdownRenderJsonSchema,
  LiveArtifactMetricRenderJsonSchema,
  LiveArtifactListRenderJsonSchema,
  LiveArtifactTableRenderJsonSchema,
  LiveArtifactLinkCardRenderJsonSchema,
  LiveArtifactJsonRenderJsonSchema
]);

export const LiveArtifactTileConnectorSourceSchema = z.object({
  connectorId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.connectorId),
  connectorName: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.connectorName, 1),
  accountLabel: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.accountLabel).nullable(),
  providerToolId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.providerToolId).nullable()
});

export const LiveArtifactTileSourceSchema = z
  .object({
    type: LiveArtifactTileSourceTypeSchema,
    toolName: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.toolName),
    input: jsonObjectSchema,
    connector: LiveArtifactTileConnectorSourceSchema.optional(),
    refreshPermission: LiveArtifactRefreshPermissionSchema,
    outputMapping: z.object({
      preferredKind: LiveArtifactTileKindSchema.optional()
    })
  })
  .superRefine((value, ctx) => {
    if (value.type === "connector_tool" && !value.connector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connector"],
        message: "connector_tool sources require connector metadata"
      });
    }
  });

export const LiveArtifactSchema = z.object({
  id: idSchema,
  schemaVersion: z.literal(LIVE_ARTIFACT_SCHEMA_VERSION),
  sessionId: nullableIdSchema,
  createdByRunId: nullableIdSchema,
  createdByToolCallId: nullableIdSchema,
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
  slug: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.slug).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: nullableBoundedString(LIVE_ARTIFACT_LIMITS.description),
  status: LiveArtifactStatusSchema,
  pinned: z.boolean(),
  refreshStatus: LiveArtifactRefreshStatusSchema,
  refreshStartedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastRefreshedAt: nullableIsoDateTimeSchema,
  lastRefreshError: nullableBoundedString(LIVE_ARTIFACT_LIMITS.error)
});

export const LiveArtifactTileSchema = z
  .object({
    id: idSchema,
    artifactId: idSchema,
    schemaVersion: z.literal(LIVE_ARTIFACT_SCHEMA_VERSION),
    position: z.number().int().nonnegative(),
    title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
    kind: LiveArtifactTileKindSchema,
    renderJson: LiveArtifactRenderJsonSchema,
    sourceJson: LiveArtifactTileSourceSchema.nullable(),
    refreshStatus: LiveArtifactRefreshStatusSchema,
    refreshStartedAt: nullableIsoDateTimeSchema,
    lastRefreshedAt: nullableIsoDateTimeSchema,
    lastError: nullableBoundedString(LIVE_ARTIFACT_LIMITS.error),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .superRefine((value, ctx) => {
    if (value.kind !== value.renderJson.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["renderJson", "kind"],
        message: "Tile kind must match renderJson kind"
      });
    }
  });

export const LiveArtifactWithTilesSchema = LiveArtifactSchema.extend({
  tiles: z.array(LiveArtifactTileSchema)
});

export const LiveArtifactCreateTileInputSchema = z.object({
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
  kind: LiveArtifactTileKindSchema,
  renderJson: LiveArtifactRenderJsonSchema,
  sourceJson: LiveArtifactTileSourceSchema.nullable().optional()
});

export const LiveArtifactCreateInputSchema = z.object({
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
  description: optionalBoundedString(LIVE_ARTIFACT_LIMITS.description).nullable(),
  sessionId: idSchema.optional().nullable(),
  tiles: z.array(LiveArtifactCreateTileInputSchema).min(1).max(50)
});

export type LiveArtifactStatus = z.infer<typeof LiveArtifactStatusSchema>;
export type LiveArtifactRefreshStatus = z.infer<typeof LiveArtifactRefreshStatusSchema>;
export type LiveArtifactTileKind = z.infer<typeof LiveArtifactTileKindSchema>;
export type LiveArtifactRefreshPermission = z.infer<typeof LiveArtifactRefreshPermissionSchema>;
export type LiveArtifactMarkdownRenderJson = z.infer<typeof LiveArtifactMarkdownRenderJsonSchema>;
export type LiveArtifactMetricRenderJson = z.infer<typeof LiveArtifactMetricRenderJsonSchema>;
export type LiveArtifactListItem = z.infer<typeof LiveArtifactListItemSchema>;
export type LiveArtifactListRenderJson = z.infer<typeof LiveArtifactListRenderJsonSchema>;
export type LiveArtifactTableRenderJson = z.infer<typeof LiveArtifactTableRenderJsonSchema>;
export type LiveArtifactLinkCardRenderJson = z.infer<typeof LiveArtifactLinkCardRenderJsonSchema>;
export type LiveArtifactJsonRenderJson = z.infer<typeof LiveArtifactJsonRenderJsonSchema>;
export type LiveArtifactRenderJson = z.infer<typeof LiveArtifactRenderJsonSchema>;
export type LiveArtifactTileConnectorSource = z.infer<typeof LiveArtifactTileConnectorSourceSchema>;
export type LiveArtifactTileSource = z.infer<typeof LiveArtifactTileSourceSchema>;
export type LiveArtifact = z.infer<typeof LiveArtifactSchema>;
export type LiveArtifactTile = z.infer<typeof LiveArtifactTileSchema>;
export type LiveArtifactWithTiles = z.infer<typeof LiveArtifactWithTilesSchema>;
export type LiveArtifactCreateTileInput = z.infer<typeof LiveArtifactCreateTileInputSchema>;
export type LiveArtifactCreateInput = z.infer<typeof LiveArtifactCreateInputSchema>;
