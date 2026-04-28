import { z } from "@hono/zod-openapi";
import { REDACTED_TOOL_CALL_SECRET, isSensitiveToolCallKey, redactSensitiveToolCallText } from "../tool-call-redaction";

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
  provenanceLabel: 200,
  provenanceSummary: 1_000,
  provenanceNote: 500,
  provenanceSources: 20,
  markdown: 20_000,
  html: 120_000,
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
  sourceJsonBytes: 32_000,
  provenanceJsonBytes: 8_000
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
export const LiveArtifactContentTypeSchema = z.literal("html_page_v1");
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

const LiveArtifactRedactedSafeTextSchema = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .transform((value) => redactSensitiveToolCallText(value))
    .pipe(LiveArtifactSafeTextSchema(max, min));

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

const jsonValueSchema: z.ZodType<LiveArtifactJsonValue> = z
  .lazy(() =>
    z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
  )
  .openapi("LiveArtifactJsonValue", {
    description: "A bounded JSON value for live artifact rendering and sanitized metadata.",
    type: ["string", "number", "boolean", "object", "array", "null"] as unknown as "object",
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "null" as unknown as "object" },
      {
        type: "array",
        items: { $ref: "#/components/schemas/LiveArtifactJsonValue" }
      },
      {
        type: "object",
        additionalProperties: { $ref: "#/components/schemas/LiveArtifactJsonValue" }
      }
    ]
  });

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

function addRawProviderResponseIssues(
  value: LiveArtifactJsonValue,
  ctx: z.RefinementCtx,
  path: Array<string | number> = []
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => addRawProviderResponseIssues(item, ctx, [...path, index]));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (rawProviderResponseKeyPattern.test(key) && (child === null || typeof child === "object")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: childPath,
        message: "Artifact records must not persist raw provider responses"
      });
    }
    addRawProviderResponseIssues(child, ctx, childPath);
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
  addRawProviderResponseIssues(value, ctx);
});

const jsonObjectSchema = z.record(LiveArtifactJsonValueSchema);

const rawProviderResponseKeyPattern = /^(?:raw|rawData|rawResponse|response|result|results|payload|body|headers|cookies?)$/i;
const broadPersonalDataKeyPattern =
  /(?:emails?|messages?|threads?|contacts?|people|users?|customers?|members?|recipients?|participants?|profile|body|content|transcript)/i;
const stableRepeatableQueryKeyPattern =
  /(?:^|_)(?:id|ids|url|uri|slug|key|name|query|q|search|filter|filters|where|sort|order|limit|offset|page|cursor|after|before|since|until|from|to|start|end|date|time|status|state|type|kind|category|label|tag|tags|workspace|project|repo|repository|owner|path|folder|calendar|channel|sheet|table)(?:_|$)/i;

function sanitizeLiveArtifactSourceInputValue(
  value: LiveArtifactJsonValue,
  path: Array<string | number>,
  ctx: z.RefinementCtx
): LiveArtifactJsonValue {
  if (typeof value === "string") {
    const redacted = redactSensitiveToolCallText(value.trim());
    if (redacted.includes(REDACTED_TOOL_CALL_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: "Tile source input must not contain credentials or tokens"
      });
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeLiveArtifactSourceInputValue(item, [...path, index], ctx));
  }

  if (value !== null && typeof value === "object") {
    return sanitizeLiveArtifactSourceInputObject(value, path, ctx);
  }

  return value;
}

function sanitizeLiveArtifactSourceInputObject(
  value: Record<string, LiveArtifactJsonValue>,
  path: Array<string | number>,
  ctx: z.RefinementCtx
): Record<string, LiveArtifactJsonValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const childPath = [...path, key];
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

      if (
        isSensitiveToolCallKey(key) ||
        /(?:password|passwd|secret|token|credential|session|cookie|privatekey)/i.test(normalizedKey)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: childPath,
          message: "Tile source input must not contain credential or token fields"
        });
      }

      if (rawProviderResponseKeyPattern.test(key) && (entry === null || typeof entry === "object")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: childPath,
          message: "Tile source input must not persist raw provider responses"
        });
      }

      if (broadPersonalDataKeyPattern.test(key) && !stableRepeatableQueryKeyPattern.test(key)) {
        const isBroadValue =
          Array.isArray(entry) ||
          (entry !== null && typeof entry === "object") ||
          (typeof entry === "string" && entry.trim().length > 500);
        if (isBroadValue) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: childPath,
            message: "Tile source input must minimize broad personal data to stable query identifiers or filters"
          });
        }
      }

      return [key.trim(), sanitizeLiveArtifactSourceInputValue(entry, childPath, ctx)];
    })
  );
}

const liveArtifactSourceInputSchema = jsonObjectSchema
  .transform((value, ctx) => sanitizeLiveArtifactSourceInputObject(value, [], ctx))
  .superRefine((value, ctx) => {
    if (getJsonByteLength(value) > LIVE_ARTIFACT_LIMITS.sourceInputBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tile source input exceeds max size of ${LIVE_ARTIFACT_LIMITS.sourceInputBytes} bytes`
      });
    }
  });

function getJsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

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
]).superRefine((value, ctx) => {
  if (getJsonByteLength(value) > LIVE_ARTIFACT_LIMITS.renderJsonBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Render JSON exceeds max size of ${LIVE_ARTIFACT_LIMITS.renderJsonBytes} bytes`
    });
  }
});

export const LiveArtifactTileConnectorSourceSchema = z.object({
  connectorId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.connectorId),
  connectorName: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.connectorName, 1),
  accountLabel: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.accountLabel).nullable(),
  providerToolId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.providerToolId).nullable()
});

export const LiveArtifactProvenanceConnectorSchema = z.object({
  connectorId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.connectorId),
  connectorName: LiveArtifactRedactedSafeTextSchema(LIVE_ARTIFACT_LIMITS.connectorName, 1),
  accountLabel: LiveArtifactRedactedSafeTextSchema(LIVE_ARTIFACT_LIMITS.accountLabel).nullable(),
  providerToolId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.providerToolId).nullable()
});

export const LiveArtifactProvenanceSourceSchema = z.object({
  type: z.enum(["static", "tool", "connector_tool"]),
  label: LiveArtifactRedactedSafeTextSchema(LIVE_ARTIFACT_LIMITS.provenanceLabel).optional(),
  toolName: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.toolName).optional(),
  connector: LiveArtifactProvenanceConnectorSchema.optional(),
  querySummary: LiveArtifactRedactedSafeTextSchema(LIVE_ARTIFACT_LIMITS.provenanceSummary).optional(),
  recordCount: z.number().int().nonnegative().max(1_000_000).optional(),
  refreshedAt: isoDateTimeSchema.optional()
});

export const LiveArtifactProvenanceJsonSchema = z
  .object({
    sources: z.array(LiveArtifactProvenanceSourceSchema).max(LIVE_ARTIFACT_LIMITS.provenanceSources).default([]),
    notes: z.array(LiveArtifactRedactedSafeTextSchema(LIVE_ARTIFACT_LIMITS.provenanceNote)).max(20).optional(),
    generatedAt: isoDateTimeSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (getJsonByteLength(value) > LIVE_ARTIFACT_LIMITS.provenanceJsonBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Provenance JSON exceeds max size of ${LIVE_ARTIFACT_LIMITS.provenanceJsonBytes} bytes`
      });
    }
  });

export const LiveArtifactTileSourceSchema = z
  .object({
    type: LiveArtifactTileSourceTypeSchema,
    toolName: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.toolName),
    input: liveArtifactSourceInputSchema,
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
    if (getJsonByteLength(value) > LIVE_ARTIFACT_LIMITS.sourceJsonBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tile source JSON exceeds max size of ${LIVE_ARTIFACT_LIMITS.sourceJsonBytes} bytes`
      });
    }
  });

function normalizeLiveArtifactHtml(value: string) {
  let html = value.trim().replace(/<!doctype\b[^>]*>/gi, "");
  const styleBlocks = Array.from(html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi), (match) => match[0] ?? "");

  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) {
    html = bodyMatch[1] ?? "";
  } else {
    html = html
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
      .replace(/<meta\b[^>]*>/gi, "")
      .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  }

  return [...styleBlocks, html].join("\n").trim();
}

export const LiveArtifactHtmlDocumentSchema = z.object({
  format: z.literal("html_template_v1"),
  sanitizedHtml: z
    .string()
    .trim()
    .transform((value) => normalizeLiveArtifactHtml(value))
    .pipe(z.string()
    .min(1)
    .max(LIVE_ARTIFACT_LIMITS.html)),
  dataJson: LiveArtifactJsonValueSchema.default({}),
  dataSchemaJson: LiveArtifactJsonValueSchema.nullable().optional(),
  sourceJson: LiveArtifactTileSourceSchema.nullable().optional(),
  sanitizerVersion: z.string().trim().min(1).max(80).default("basic-html-v1")
}).strict().superRefine((value, ctx) => {
  if (getJsonByteLength(value.dataJson) > LIVE_ARTIFACT_LIMITS.renderJsonBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dataJson"],
      message: `Document data JSON exceeds max size of ${LIVE_ARTIFACT_LIMITS.renderJsonBytes} bytes`
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
  contentType: LiveArtifactContentTypeSchema.default("html_page_v1"),
  currentRevisionId: idSchema.nullable().default(null),
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
    provenanceJson: LiveArtifactProvenanceJsonSchema.nullable(),
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
  tiles: z.array(LiveArtifactTileSchema),
  document: LiveArtifactHtmlDocumentSchema.nullable().default(null)
});

export const LiveArtifactCreateTileInputSchema = z
  .object({
    title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1),
    kind: LiveArtifactTileKindSchema,
    renderJson: LiveArtifactRenderJsonSchema,
    provenanceJson: LiveArtifactProvenanceJsonSchema.nullable().optional(),
    sourceJson: LiveArtifactTileSourceSchema.nullable().optional()
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

export const LiveArtifactCreateInputSchema = z.object({
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1).describe("Short title for the HTML live artifact."),
  description: optionalBoundedString(LIVE_ARTIFACT_LIMITS.description).nullable().describe("Optional human-readable description."),
  sessionId: idSchema.optional().nullable(),
  contentType: LiveArtifactContentTypeSchema.optional().default("html_page_v1").describe("Must be html_page_v1."),
  document: LiveArtifactHtmlDocumentSchema.describe("Required HTML page document. Put the page markup in sanitizedHtml and dynamic values in dataJson. Do not send tiles or renderJson.")
}).strict().superRefine((value, ctx) => {
  if (value.contentType !== "html_page_v1") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contentType"], message: "Only html_page_v1 live artifacts are supported" });
  }
});

export type LiveArtifactStatus = z.infer<typeof LiveArtifactStatusSchema>;
export type LiveArtifactContentType = z.infer<typeof LiveArtifactContentTypeSchema>;
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
export type LiveArtifactProvenanceConnector = z.infer<typeof LiveArtifactProvenanceConnectorSchema>;
export type LiveArtifactProvenanceSource = z.infer<typeof LiveArtifactProvenanceSourceSchema>;
export type LiveArtifactProvenanceJson = z.infer<typeof LiveArtifactProvenanceJsonSchema>;
export type LiveArtifactTileSource = z.infer<typeof LiveArtifactTileSourceSchema>;
export type LiveArtifact = z.infer<typeof LiveArtifactSchema>;
export type LiveArtifactHtmlDocument = z.infer<typeof LiveArtifactHtmlDocumentSchema>;
export type LiveArtifactTile = z.infer<typeof LiveArtifactTileSchema>;
export type LiveArtifactWithTiles = z.infer<typeof LiveArtifactWithTilesSchema>;
export type LiveArtifactCreateTileInput = z.infer<typeof LiveArtifactCreateTileInputSchema>;
export type LiveArtifactCreateInput = z.input<typeof LiveArtifactCreateInputSchema>;
