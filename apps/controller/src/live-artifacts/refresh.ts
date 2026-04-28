import type { ChatStorage } from "../chat-storage";
import type { Logger } from "../logger";
import type { RegisteredToolDefinition, ToolRegistry } from "../tools/registry";
import { sanitizeLiveArtifactRefreshRenderJson } from "./render";
import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactJsonValueSchema,
  type LiveArtifactJsonValue,
  type LiveArtifactHtmlDocument,
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
  readonly failures: readonly LiveArtifactRefreshFailure[];
}

export interface LiveArtifactRefreshFailure {
  readonly tileId: string;
  readonly tileTitle: string;
  readonly toolName: string;
  readonly error: string;
}

export async function refreshLiveArtifact(options: RefreshLiveArtifactOptions): Promise<RefreshLiveArtifactResult> {
  const artifact = options.chatStorage.getLiveArtifact(options.artifactId);

  if (artifact.contentType === "html_page_v1") {
    return refreshLiveArtifactDocument(options, artifact);
  }

  const refreshableTileIds = artifact.tiles.filter(isRefreshEligibleTile).map((tile) => tile.id);
  const refresh = options.chatStorage.startLiveArtifactRefresh({
    artifactId: artifact.id,
    scope: "artifact",
    tileIdsToRefresh: refreshableTileIds
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
    const failures = [] as LiveArtifactRefreshFailure[];

    for (const tile of artifact.tiles) {
      if (!isRefreshEligibleTile(tile)) {
        continue;
      }

      let stepId: string | null = null;
      let source: LiveArtifactTileSource | null = null;
      try {
        source = tile.sourceJson;
        const definition = definitionsByName.get(source.toolName);
        if (!definition) {
          throw new Error(`Refresh tool is unavailable: ${source.toolName}`);
        }
        validateRefreshSourceBeforeExecution(source, definition);

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
        stepId = step.id;

        if (!options.chatStorage.markLiveArtifactRefreshStepRunning(step.id)) {
          throw new Error(`Refresh step could not start for tile: ${tile.id}`);
        }

        let connectorExecutionMetadata: Parameters<ChatStorage["completeLiveArtifactRefreshStep"]>[0]["connectorExecutionMetadata"];
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
        const renderJson = mapToolOutputToRenderJson(output, getPreferredRenderKind(source.outputMapping.preferredKind, tile.kind), tile.title);
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
        const message = error instanceof Error ? error.message : "refresh_step_failed";
        if (stepId) {
          options.chatStorage.failLiveArtifactRefreshStep({
            stepId,
            errorMessage: message
          });
        }
        failures.push({
          tileId: tile.id,
          tileTitle: tile.title,
          toolName: source?.toolName ?? "unknown",
          error: message
        });
        options.logger.warn("live_artifacts.refresh_tile_failed", {
          artifactId: artifact.id,
          refreshId: refresh.id,
          tileId: tile.id,
          error: message
        });
      }
    }

    const updatedArtifact = refreshedTiles.length > 0 || failures.length > 0
      ? options.chatStorage.applyLiveArtifactRefreshResults({
          artifactId: artifact.id,
          tiles: refreshedTiles,
          failedTiles: failures.map((failure) => ({
            tileId: failure.tileId,
            errorMessage: failure.error
          }))
        })
      : artifact;
    const status = failures.length === 0
      ? "completed"
      : refreshedTiles.length > 0
        ? "partial_failed"
        : "failed";
    options.chatStorage.completeLiveArtifactRefresh({
      refreshId: refresh.id,
      status,
      errorMessage: failures.length > 0 ? `${failures.length} tile${failures.length === 1 ? "" : "s"} failed to refresh.` : null
    });

    return { artifact: updatedArtifact, failures };
  } catch (error) {
    const message = error instanceof Error ? error.message : "live_artifact_refresh_failed";
    options.chatStorage.completeLiveArtifactRefresh({ refreshId: refresh.id, status: "failed", errorMessage: message });
    options.logger.warn("live_artifacts.refresh_failed", { artifactId: artifact.id, refreshId: refresh.id, error: message });
    throw error;
  }
}

async function refreshLiveArtifactDocument(options: RefreshLiveArtifactOptions, artifact: LiveArtifactWithTiles): Promise<RefreshLiveArtifactResult> {
  const source = artifact.document?.sourceJson;

  if (!artifact.document || source?.refreshPermission !== "manual_refresh_granted_for_read_only") {
    throw new Error("This HTML artifact has no refreshable data source.");
  }

  const refresh = options.chatStorage.startLiveArtifactRefresh({
    artifactId: artifact.id,
    scope: "artifact",
    tileIdsToRefresh: []
  });
  const abortSignal = options.abortSignal ?? new AbortController().signal;
  let stepId: string | null = null;

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
    const definition = definitionsByName.get(source.toolName);

    if (!definition) {
      throw new Error(`Refresh tool is unavailable: ${source.toolName}`);
    }

    validateRefreshSourceBeforeExecution(source, definition);

    const connectorMetadata = source.type === "connector_tool"
      ? createConnectorAuditMetadata(source, definition)
      : null;
    const step = options.chatStorage.startLiveArtifactRefreshStep({
      refreshId: refresh.id,
      tileId: null,
      sourceType: source.type,
      toolName: source.toolName,
      input: source.input,
      connectorMetadata
    });
    stepId = step.id;

    if (!options.chatStorage.markLiveArtifactRefreshStepRunning(step.id)) {
      throw new Error("Refresh step could not start for HTML artifact document.");
    }

    let connectorExecutionMetadata: Parameters<ChatStorage["completeLiveArtifactRefreshStep"]>[0]["connectorExecutionMetadata"];
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
    const dataJson = mapToolOutputToDocumentDataJson(output, artifact.document.dataJson, getRefreshDataPaths(source.outputMapping.dataPaths), artifact.document.dataSchemaJson);
    const updatedDocument: LiveArtifactHtmlDocument = {
      ...artifact.document,
      sanitizedHtml: refreshStaticRepositoryHtml(artifact.document.sanitizedHtml, dataJson),
      dataJson,
      sourceJson: source
    };

    options.chatStorage.completeLiveArtifactRefreshStep({
      stepId: step.id,
      ...(connectorExecutionMetadata ? { connectorExecutionMetadata } : {})
    });

    const updatedArtifact = options.chatStorage.applyLiveArtifactDocumentRefreshResult({
      artifactId: artifact.id,
      document: updatedDocument
    });
    options.chatStorage.completeLiveArtifactRefresh({ refreshId: refresh.id, status: "completed", errorMessage: null });

    return { artifact: updatedArtifact, failures: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "live_artifact_document_refresh_failed";
    if (stepId) {
      options.chatStorage.failLiveArtifactRefreshStep({ stepId, errorMessage: message });
    }
    options.chatStorage.completeLiveArtifactRefresh({ refreshId: refresh.id, status: "failed", errorMessage: message });
    options.logger.warn("live_artifacts.refresh_document_failed", { artifactId: artifact.id, refreshId: refresh.id, error: message });
    throw error;
  }
}

function isRefreshEligibleTile(tile: LiveArtifactTile): tile is LiveArtifactTile & { sourceJson: LiveArtifactTileSource } {
  return tile.sourceJson?.refreshPermission === "manual_refresh_granted_for_read_only";
}

function validateRefreshSourceBeforeExecution(source: LiveArtifactTileSource, definition: RegisteredToolDefinition<unknown, unknown>): void {
  if (source.refreshPermission !== "manual_refresh_granted_for_read_only") {
    throw new Error(`Refresh permission is not granted for tool: ${source.toolName}`);
  }

  if (source.type !== "connector_tool") {
    throw new Error(`Refresh source must be a read-only connector tool: ${source.toolName}`);
  }

  if (definition.metadata.requiresConfirmation) {
    throw new Error(`Refresh tool requires confirmation: ${source.toolName}`);
  }

  const schemaError = validateInputAgainstCurrentSchema(source.input, definition.inputSchema);
  if (schemaError) {
    throw new Error(`Refresh source input no longer matches current tool schema for ${source.toolName}: ${schemaError}`);
  }

  const currentConnector = definition.metadata.connector;

  const storedConnector = source.connector;

  if (!storedConnector || !currentConnector) {
    throw new Error(`Connector refresh source is missing audit metadata: ${source.toolName}`);
  }

  if (storedConnector.connectorId !== currentConnector.connectorId) {
    throw new Error(`Connector refresh source connector has changed: ${source.toolName}`);
  }

  if (storedConnector.accountLabel && currentConnector.accountLabel && storedConnector.accountLabel !== currentConnector.accountLabel) {
    throw new Error(`Connector refresh source account is stale: ${source.toolName}`);
  }

  if (currentConnector.connected !== true || currentConnector.connectionState !== "connected") {
    throw new Error(`Connector account is not available for refresh: ${source.toolName}`);
  }

  const currentPolicy = getConnectorToolApprovalPolicy(currentConnector.approvalPolicy);
  if (!currentPolicy) {
    throw new Error(`Connector refresh source is not currently classified as read-only: ${source.toolName}`);
  }

  if (currentPolicy.sideEffect !== "read" || currentPolicy.approval === "always") {
    throw new Error(`Connector refresh source is not currently classified as read-only: ${source.toolName}`);
  }
}

function getPreferredRenderKind(value: unknown, fallback: LiveArtifactTileKind): LiveArtifactTileKind {
  return value === "markdown" || value === "metric" || value === "list" || value === "table" || value === "link_card" || value === "json"
    ? value
    : fallback;
}

function getRefreshDataPaths(value: unknown): Record<string, string | string[]> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string | string[]] => {
    const [, sourcePath] = entry;
    return typeof sourcePath === "string" || (Array.isArray(sourcePath) && sourcePath.every((path) => typeof path === "string"));
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getConnectorToolApprovalPolicy(policy: unknown): {
  readonly sideEffect: "read" | "write" | "destructive" | "external_send";
  readonly approval: "never" | "first_use" | "always";
} | null {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return null;
  }

  const sideEffect = (policy as { sideEffect?: unknown }).sideEffect;
  const approval = (policy as { approval?: unknown }).approval;

  if (approval !== "never" && approval !== "first_use" && approval !== "always") {
    return null;
  }

  switch (sideEffect) {
    case "read":
    case "write":
    case "destructive":
    case "external_send":
      return { sideEffect, approval };
    default:
      return null;
  }
}

function validateInputAgainstCurrentSchema(input: LiveArtifactJsonValue, schema: unknown): string | null {
  const jsonSchema = unwrapJsonSchema(schema);

  if (!jsonSchema || Object.keys(jsonSchema).length === 0) {
    return null;
  }

  return validateJsonSchemaValue(input, jsonSchema, "input");
}

function unwrapJsonSchema(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }

  const record = schema as Record<string, unknown>;
  for (const key of ["schema", "jsonSchema", "parameters"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }

  return record;
}

function validateJsonSchemaValue(value: unknown, schema: Record<string, unknown>, path: string): string | null {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;
  if (enumValues && !enumValues.some((candidate) => candidate === value)) {
    return `${path} must be one of the current enum values`;
  }

  const type = schema.type;
  if (typeof type === "string") {
    const typeError = validateJsonSchemaType(value, type, path);
    if (typeError) {
      return typeError;
    }
  }

  if ((type === "object" || schema.properties || schema.required || schema.additionalProperties === false) && isPlainRecord(value)) {
    const properties = isPlainRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];

    for (const key of required) {
      if (!(key in value)) {
        return `${path}.${key} is required by the current tool schema`;
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          return `${path}.${key} is not accepted by the current tool schema`;
        }
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value) || !isPlainRecord(childSchema)) {
        continue;
      }

      const childError = validateJsonSchemaValue(value[key], childSchema, `${path}.${key}`);
      if (childError) {
        return childError;
      }
    }
  }

  return null;
}

function validateJsonSchemaType(value: unknown, type: string, path: string): string | null {
  switch (type) {
    case "object":
      return isPlainRecord(value) ? null : `${path} must be an object`;
    case "array":
      return Array.isArray(value) ? null : `${path} must be an array`;
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a number`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "null":
      return value === null ? null : `${path} must be null`;
    default:
      return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
      return { kind: "markdown", markdown: extractMarkdownSummary(output, fallbackLabel) };
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

function mapToolOutputToDocumentDataJson(
  output: unknown,
  previousDataJson?: LiveArtifactJsonValue,
  dataPaths?: Record<string, string | string[]>,
  dataSchemaJson?: LiveArtifactJsonValue | null
): LiveArtifactJsonValue {
  const candidate = dataPaths
    ? output
    : output && typeof output === "object" && !Array.isArray(output) && "dataJson" in output
    ? (output as { dataJson?: unknown }).dataJson
    : output;

  const pathMapped = mapToolOutputByDataPaths(candidate, previousDataJson, dataPaths);
  if (pathMapped !== null) {
    return pathMapped;
  }

  const legacySchemaMapped = mapLegacySingleRepositoryOutputToDocumentSchema(candidate, dataSchemaJson);
  if (legacySchemaMapped !== null) {
    return legacySchemaMapped;
  }

  const remapped = mapToolOutputToPreviousDocumentShape(candidate, previousDataJson);
  if (remapped !== null) {
    return remapped;
  }
  const normalized = normalizeJsonValue(candidate);
  return LiveArtifactJsonValueSchema.parse(normalized);
}

function mapToolOutputByDataPaths(
  output: unknown,
  previousDataJson: LiveArtifactJsonValue | undefined,
  dataPaths: Record<string, string | string[]> | undefined
): LiveArtifactJsonValue | null {
  if (!dataPaths || Object.keys(dataPaths).length === 0) {
    return null;
  }

  const mapped = isPlainRecord(previousDataJson) ? deepCloneJsonRecord(previousDataJson) : {};
  const missingDestinationPaths: string[] = [];
  let changed = false;

  for (const [destinationPath, sourcePathOrPaths] of Object.entries(dataPaths)) {
    const sourcePaths = Array.isArray(sourcePathOrPaths) ? sourcePathOrPaths : [sourcePathOrPaths];
    const value = readFirstMappedValue(output, sourcePaths);

    if (value === undefined) {
      missingDestinationPaths.push(destinationPath);
      continue;
    }

    setMappedValue(mapped, destinationPath, normalizeJsonValue(value));
    changed = true;
  }

  if (!changed) {
    throw new Error("Refresh output did not match any configured data path mappings.");
  }

  if (missingDestinationPaths.length > 0) {
    throw new Error(`Refresh output is missing configured data path mappings: ${missingDestinationPaths.join(", ")}`);
  }

  return LiveArtifactJsonValueSchema.parse(mapped);
}

function deepCloneJsonRecord(value: Record<string, unknown>): Record<string, LiveArtifactJsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, LiveArtifactJsonValue>;
}

function readFirstMappedValue(output: unknown, sourcePaths: string[]): unknown {
  for (const sourcePath of sourcePaths) {
    const value = readMappedValue(output, sourcePath);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readMappedValue(value: unknown, path: string): unknown {
  if (path === "$") {
    return value;
  }

  const segments = path.startsWith("$.") ? path.slice(2).split(".") : path.split(".");

  return segments.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      return /^\d+$/.test(segment) ? current[Number(segment)] : undefined;
    }

    if (typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, value);
}

function setMappedValue(target: Record<string, LiveArtifactJsonValue>, path: string, value: LiveArtifactJsonValue): void {
  const segments = path.split(".");
  const last = segments.pop();

  if (!last) {
    return;
  }

  let current: Record<string, LiveArtifactJsonValue> = target;
  for (const segment of segments) {
    const next = current[segment];
    if (!isPlainRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, LiveArtifactJsonValue>;
  }

  current[last] = value;
}

function mapLegacySingleRepositoryOutputToDocumentSchema(output: unknown, dataSchemaJson: LiveArtifactJsonValue | null | undefined): LiveArtifactJsonValue | null {
  if (!isPlainRecord(output) || !isPlainRecord(dataSchemaJson) || !("stars" in dataSchemaJson)) {
    return null;
  }

  const stars = readRepositoryStarCount(output);
  if (stars === undefined) {
    return null;
  }

  const fullName = typeof output.full_name === "string" ? output.full_name : "";
  const [fallbackOwner, fallbackRepo] = fullName.split("/");
  const owner = isPlainRecord(output.owner) ? output.owner : isPlainRecord(output.organization) ? output.organization : {};

  return LiveArtifactJsonValueSchema.parse({
    owner: stringFrom(owner.login, fallbackOwner, "unknown"),
    repo: stringFrom(output.name, fallbackRepo, "Repository"),
    stars
  });
}

function refreshStaticRepositoryHtml(html: string, dataJson: LiveArtifactJsonValue): string {
  if (!isPlainRecord(dataJson) || hasLiveArtifactBindingMarker(html)) {
    return html;
  }

  let updatedHtml = html;
  const stars = typeof dataJson.stars === "number" || typeof dataJson.stars === "string" ? String(dataJson.stars) : null;
  const owner = typeof dataJson.owner === "string" ? dataJson.owner : null;
  const repo = typeof dataJson.repo === "string" ? dataJson.repo : null;

  if (stars) {
    updatedHtml = replaceElementTextByClass(updatedHtml, "stars", stars);
  }

  if (owner && repo) {
    updatedHtml = replaceElementTextByClass(updatedHtml, "repo", `${owner}/${repo}`);
  }

  return updatedHtml;
}

function hasLiveArtifactBindingMarker(html: string): boolean {
  return /\{\{\s*data\./.test(html) || /\bdata-(?:bind|bind-attr|bind-style|repeat)\b/.test(html);
}

function replaceElementTextByClass(html: string, className: string, value: string): string {
  const escapedClassName = escapeRegExp(className);
  const pattern = new RegExp(`(<([a-z][a-z0-9-]*)\\b(?=[^>]*\\bclass=(['\"])[^'\"]*\\b${escapedClassName}\\b[^'\"]*\\3)[^>]*>)([^<]*)(<\\/\\2>)`, "i");
  return html.replace(pattern, (_match, open: string, _tag: string, _quote: string, _text: string, close: string) => `${open}${escapeHtmlText(value)}${close}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mapToolOutputToPreviousDocumentShape(output: unknown, previousDataJson: LiveArtifactJsonValue | undefined): LiveArtifactJsonValue | null {
  if (!isPlainRecord(previousDataJson) || !Array.isArray(previousDataJson.repos)) {
    return null;
  }

  const items = extractArrayByKey(output, "items");
  if (!items) {
    return null;
  }

  const previousRepos = previousDataJson.repos.reduce<Record<string, unknown>[]>((repos, repo) => {
    if (isPlainRecord(repo)) {
      repos.push(repo);
    }
    return repos;
  }, []);
  const repos = items.slice(0, previousRepos.length || 5).filter(isPlainRecord).map((item, index) => {
    const owner = isPlainRecord(item.owner) ? item.owner : {};
    const previous = previousRepos[index] ?? {};
    const fullName = typeof item.full_name === "string" ? item.full_name : "";
    const [fallbackOwner, fallbackName] = fullName.split("/");
    const stars = readRepositoryStarCount(item);
    const forks = typeof item.forks_count === "number"
      ? item.forks_count
      : typeof item.forks === "number"
        ? item.forks
        : undefined;

    return {
      ...previous,
      rank: typeof previous.rank === "string" && /^0?\d+$/.test(previous.rank)
        ? String(index + 1).padStart(previous.rank.length, "0")
        : index + 1,
      name: stringFrom(item.name, fallbackName, previous.name, "Repository"),
      owner: stringFrom(owner.login, fallbackOwner, previous.owner, "unknown"),
      url: stringFrom(item.html_url, previous.url, "#"),
      avatar: stringFrom(owner.avatar_url, previous.avatar, ""),
      description: stringFrom(item.description, previous.description, "No description provided."),
      topics: Array.isArray(item.topics) ? item.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 6) : previous.topics,
      stars: stars === undefined ? previous.stars : formatCompactNumber(stars),
      forks: forks === undefined ? previous.forks : formatCompactNumber(forks),
      language: stringFrom(item.language, previous.language, "Unknown")
    };
  });

  return LiveArtifactJsonValueSchema.parse({
    ...previousDataJson,
    repos
  });
}

function readRepositoryStarCount(item: Record<string, unknown>): number | undefined {
  return typeof item.stargazers_count === "number"
    ? item.stargazers_count
    : typeof item.watchers_count === "number"
      ? item.watchers_count
      : typeof item.watchers === "number"
        ? item.watchers
        : typeof item.stars === "number"
          ? item.stars
          : undefined;
}

function extractArrayByKey(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (isPlainRecord(value) && Array.isArray(value[key])) {
    return value[key];
  }

  return null;
}

function stringFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimTrailingZero((value / 1_000_000).toFixed(1))}m`;
  }

  if (value >= 1_000) {
    return `${trimTrailingZero((value / 1_000).toFixed(1))}k`;
  }

  return String(value);
}

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
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
  const items = extractPrimaryArray(output) ?? [output];

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

function extractMarkdownSummary(output: unknown, fallbackLabel: string): string {
  const items = extractListItems(output).slice(0, 20);
  if (items.length > 1) {
    const lines = items.map((item) => {
      const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
      const title = item.url ? `[${item.title}](${item.url})` : item.title;
      return `- ${title}${subtitle}`;
    });
    return [`## ${fallbackLabel}`, "", ...lines].join("\n");
  }

  return stringifyDisplayValue(output);
}

function extractPrimaryArray(output: unknown): unknown[] | null {
  if (Array.isArray(output)) {
    return output;
  }
  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as Record<string, unknown>;
  for (const key of ["items", "repositories", "repos", "records", "data", "values"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return null;
}

function extractTable(output: unknown): LiveArtifactRenderJson | null {
  const rows = extractPrimaryArray(output);
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
