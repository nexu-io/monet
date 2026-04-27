import type { ChatStorage } from "../chat-storage";
import type { Logger } from "../logger";
import type { RegisteredToolDefinition, ToolRegistry } from "../tools/registry";
import { sanitizeLiveArtifactRefreshRenderJson } from "./render";
import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactJsonValueSchema,
  type LiveArtifactJsonValue,
  type LiveArtifactProvenanceJson,
  type LiveArtifactRenderJson,
  type LiveArtifactTile,
  type LiveArtifactTileKind,
  type LiveArtifactTileSource,
  type LiveArtifactWithTiles
} from "./schema";

export interface RefreshLiveArtifactOptions {
  readonly artifactId: string;
  readonly chatStorage: ChatStorage;
  readonly toolRegistry: ToolRegistry;
  readonly sessionWorkspacePath: string;
  readonly logger: Logger;
  readonly abortSignal?: AbortSignal;
}

export interface RefreshLiveArtifactResult {
  readonly artifact: LiveArtifactWithTiles;
}

export async function refreshLiveArtifact(options: RefreshLiveArtifactOptions): Promise<RefreshLiveArtifactResult> {
  const artifact = options.chatStorage.getLiveArtifact(options.artifactId);
  const refresh = options.chatStorage.startLiveArtifactRefresh({
    artifactId: artifact.id,
    scope: "artifact"
  });
  const abortSignal = options.abortSignal ?? new AbortController().signal;

  try {
    const definitions = await options.toolRegistry.resolveTools({
      runId: refresh.id,
      sessionId: artifact.sessionId ?? refresh.id,
      sessionWorkspacePath: options.sessionWorkspacePath,
      chatStorage: options.chatStorage,
      logger: options.logger,
      abortSignal
    });
    const definitionsByName = new Map(definitions.map((definition) => [definition.metadata.name, definition]));
    const refreshedTiles = [] as Array<{
      tileId: string;
      kind: LiveArtifactTileKind;
      renderJson: LiveArtifactRenderJson;
      provenanceJson: LiveArtifactProvenanceJson | null;
    }>;

    for (const tile of artifact.tiles) {
      if (!isRefreshEligibleTile(tile)) {
        continue;
      }

      const source = tile.sourceJson;
      const definition = definitionsByName.get(source.toolName);
      if (!definition) {
        throw new Error(`Refresh tool is unavailable: ${source.toolName}`);
      }
      if (definition.metadata.requiresConfirmation) {
        throw new Error(`Refresh tool requires confirmation: ${source.toolName}`);
      }

      const connectorMetadata = source.type === "connector_tool"
        ? createConnectorAuditMetadata(source, definition)
        : null;
      const step = options.chatStorage.startLiveArtifactRefreshStep({
        refreshId: refresh.id,
        tileId: tile.id,
        sourceType: source.type,
        toolName: source.toolName,
        input: source.input,
        connectorMetadata
      });

      if (!options.chatStorage.markLiveArtifactRefreshStepRunning(step.id)) {
        throw new Error(`Refresh step could not start for tile: ${tile.id}`);
      }

      let connectorExecutionMetadata: Parameters<ChatStorage["completeLiveArtifactRefreshStep"]>[0]["connectorExecutionMetadata"];
      try {
        const output = await definition.execute(source.input, {
          toolCallId: step.id,
          persistedToolCallId: step.id,
          sessionId: artifact.sessionId ?? refresh.id,
          sessionWorkspacePath: options.sessionWorkspacePath,
          messages: [],
          abortSignal,
          setConnectorExecutionMetadata(metadata) {
            connectorExecutionMetadata = metadata;
          }
        });
        const renderJson = mapToolOutputToRenderJson(output, source.outputMapping.preferredKind ?? tile.kind, tile.title);
        const sanitized = sanitizeLiveArtifactRefreshRenderJson(renderJson, tile.renderJson);

        if (!sanitized.ok) {
          throw new Error(sanitized.error);
        }

        options.chatStorage.completeLiveArtifactRefreshStep({
          stepId: step.id,
          ...(connectorExecutionMetadata ? { connectorExecutionMetadata } : {})
        });
        refreshedTiles.push({
          tileId: tile.id,
          kind: sanitized.renderJson.kind,
          renderJson: sanitized.renderJson,
          provenanceJson: createRefreshProvenance(source)
        });
      } catch (error) {
        options.chatStorage.failLiveArtifactRefreshStep({
          stepId: step.id,
          errorMessage: error instanceof Error ? error.message : "refresh_step_failed"
        });
        throw error;
      }
    }

    const updatedArtifact = refreshedTiles.length > 0
      ? options.chatStorage.applyLiveArtifactRefreshResults({ artifactId: artifact.id, tiles: refreshedTiles })
      : artifact;
    options.chatStorage.completeLiveArtifactRefresh({ refreshId: refresh.id, status: "completed" });

    return { artifact: updatedArtifact };
  } catch (error) {
    const message = error instanceof Error ? error.message : "live_artifact_refresh_failed";
    options.chatStorage.completeLiveArtifactRefresh({ refreshId: refresh.id, status: "failed", errorMessage: message });
    options.logger.warn("live_artifacts.refresh_failed", { artifactId: artifact.id, refreshId: refresh.id, error: message });
    throw error;
  }
}

function isRefreshEligibleTile(tile: LiveArtifactTile): tile is LiveArtifactTile & { sourceJson: LiveArtifactTileSource } {
  return tile.sourceJson?.refreshPermission === "manual_refresh_granted_for_read_only";
}

function createConnectorAuditMetadata(source: LiveArtifactTileSource, definition: RegisteredToolDefinition<unknown, unknown>) {
  const connector = definition.metadata.connector;
  const storedConnector = source.connector;

  if (!connector || !storedConnector) {
    throw new Error(`Connector refresh source is missing audit metadata: ${source.toolName}`);
  }

  return {
    connectorId: connector.connectorId,
    connectorName: connector.connectorName,
    connectorAccountLabel: connector.accountLabel ?? storedConnector.accountLabel,
    connectorToolName: connector.toolName,
    connectorProviderToolId: connector.providerToolId,
    connectorArgumentsSummary: summarizeForAudit(source.input),
    connectorApprovalPolicy: connector.approvalPolicy,
    approvalBasis: "manual_refresh_granted_for_read_only"
  };
}

function mapToolOutputToRenderJson(output: unknown, preferredKind: LiveArtifactTileKind, fallbackLabel: string): LiveArtifactRenderJson {
  const alreadyRenderJson = tryParseRenderJson(output);
  if (alreadyRenderJson && (alreadyRenderJson.kind === preferredKind || preferredKind === "json")) {
    return alreadyRenderJson;
  }

  switch (preferredKind) {
    case "markdown":
      return { kind: "markdown", markdown: stringifyDisplayValue(output) };
    case "metric":
      return { kind: "metric", label: fallbackLabel, value: extractMetricValue(output) };
    case "list":
      return { kind: "list", items: extractListItems(output) };
    case "table":
      return extractTable(output) ?? toJsonRenderJson(output);
    case "link_card":
      return extractLinkCard(output) ?? toJsonRenderJson(output);
    case "json":
      return toJsonRenderJson(output);
  }
}

function tryParseRenderJson(value: unknown): LiveArtifactRenderJson | null {
  const result = sanitizeLiveArtifactRefreshRenderJson(value, null);
  return result.ok ? result.renderJson : null;
}

function toJsonRenderJson(output: unknown): LiveArtifactRenderJson {
  const value = normalizeJsonValue(output);
  const parsed = LiveArtifactJsonValueSchema.safeParse(value);
  return { kind: "json", value: parsed.success ? parsed.data : stringifyDisplayValue(output) };
}

function extractMetricValue(output: unknown): string {
  if (typeof output === "number" || typeof output === "bigint" || typeof output === "boolean") {
    return String(output);
  }
  if (typeof output === "string") {
    return truncateText(output, LIVE_ARTIFACT_LIMITS.metricValue);
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    for (const key of ["value", "count", "total", "amount", "metric"]) {
      const value = (output as Record<string, unknown>)[key];
      if (["string", "number", "boolean", "bigint"].includes(typeof value)) {
        return truncateText(String(value), LIVE_ARTIFACT_LIMITS.metricValue);
      }
    }
  }

  return truncateText(stringifyDisplayValue(output), LIVE_ARTIFACT_LIMITS.metricValue);
}

function extractListItems(output: unknown): { title: string; subtitle?: string; url?: string }[] {
  const items = Array.isArray(output) ? output : output && typeof output === "object" && Array.isArray((output as Record<string, unknown>).items)
    ? (output as Record<string, unknown>).items as unknown[]
    : [output];

  return items.slice(0, LIVE_ARTIFACT_LIMITS.listItems).map((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const title = getFirstString(record, ["title", "name", "label", "id"]) ?? `Item ${index + 1}`;
      const subtitle = getFirstString(record, ["subtitle", "summary", "description", "status"]);
      const url = getSafeUrl(getFirstString(record, ["url", "link", "href"]));
      return {
        title: truncateText(title, LIVE_ARTIFACT_LIMITS.listItemTitle),
        ...(subtitle ? { subtitle: truncateText(subtitle, LIVE_ARTIFACT_LIMITS.listItemSubtitle) } : {}),
        ...(url ? { url } : {})
      };
    }

    return { title: truncateText(stringifyDisplayValue(item), LIVE_ARTIFACT_LIMITS.listItemTitle) };
  });
}

function extractTable(output: unknown): LiveArtifactRenderJson | null {
  const rows = Array.isArray(output) ? output : output && typeof output === "object" && Array.isArray((output as Record<string, unknown>).rows)
    ? (output as Record<string, unknown>).rows as unknown[]
    : null;
  if (!rows || rows.length === 0 || !rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    return null;
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row as Record<string, unknown>))))
    .slice(0, LIVE_ARTIFACT_LIMITS.tableColumns);
  if (columns.length === 0) {
    return null;
  }

  return {
    kind: "table",
    columns,
    rows: rows.slice(0, LIVE_ARTIFACT_LIMITS.tableRows).map((row) => {
      const record = row as Record<string, unknown>;
      return columns.map((column) => truncateText(stringifyDisplayValue(record[column]), LIVE_ARTIFACT_LIMITS.tableCell));
    })
  };
}

function extractLinkCard(output: unknown): LiveArtifactRenderJson | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const url = getSafeUrl(getFirstString(record, ["url", "link", "href"]));
  if (!url) {
    return null;
  }

  return {
    kind: "link_card",
    title: truncateText(getFirstString(record, ["title", "name", "label"]) ?? url, LIVE_ARTIFACT_LIMITS.title),
    url,
    ...(getFirstString(record, ["description", "summary"]) ? { description: truncateText(getFirstString(record, ["description", "summary"]) ?? "", LIVE_ARTIFACT_LIMITS.description) } : {})
  };
}

function createRefreshProvenance(source: LiveArtifactTileSource): LiveArtifactProvenanceJson {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    sources: [{
      type: source.type,
      label: source.connector?.connectorName ?? source.toolName,
      toolName: source.toolName,
      ...(source.connector ? { connector: source.connector } : {}),
      querySummary: summarizeForAudit(source.input),
      refreshedAt: now
    }]
  };
}

function normalizeJsonValue(value: unknown, depth = 0): LiveArtifactJsonValue {
  if (depth >= LIVE_ARTIFACT_LIMITS.jsonDepth) {
    return "[Max depth reached]";
  }
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return typeof value === "string" ? truncateText(value, LIVE_ARTIFACT_LIMITS.tableCell) : value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, LIVE_ARTIFACT_LIMITS.jsonArrayItems).map((item) => normalizeJsonValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, LIVE_ARTIFACT_LIMITS.jsonObjectKeys)
        .map(([key, child]) => [safeJsonKey(key), normalizeJsonValue(child, depth + 1)])
    );
  }
  return stringifyDisplayValue(value);
}

function safeJsonKey(key: string): string {
  const trimmed = key.trim() || "value";
  return /^(?:raw|rawData|rawResponse|response|result|results|payload|body|headers|cookies?)$/i.test(trimmed)
    ? `provider_${trimmed}`
    : trimmed;
}

function getFirstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
  }
  return null;
}

function getSafeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stringifyDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "No data";
  }
  if (typeof value === "string") {
    return truncateText(value, LIVE_ARTIFACT_LIMITS.markdown);
  }
  try {
    return truncateText(JSON.stringify(normalizeJsonValue(value), null, 2), LIVE_ARTIFACT_LIMITS.markdown);
  } catch {
    return truncateText(String(value), LIVE_ARTIFACT_LIMITS.markdown);
  }
}

function summarizeForAudit(value: unknown): string {
  return truncateText(stringifyDisplayValue(value).replace(/\s+/g, " "), LIVE_ARTIFACT_LIMITS.provenanceSummary);
}

function truncateText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 1))}…` : trimmed || "No data";
}
