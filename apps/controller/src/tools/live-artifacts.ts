import { z } from "@hono/zod-openapi";

import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactCreateInputSchema,
  LiveArtifactSafeTextSchema
} from "../live-artifacts/schema";
import { type RegisteredToolDefinition, type ToolSource } from "./registry";
import type { ChatStorage } from "../chat-storage";
import type { LiveArtifact, LiveArtifactWithTiles } from "../live-artifacts/schema";
import type { ToolMetadata } from "./registry";

const artifactUrlFor = (artifactId: string) => `/artifacts/${artifactId}`;

const ListLiveArtifactsInputSchema = z.object({
  includeArchived: z.boolean().optional().describe("Include archived artifacts. Defaults to false."),
  sessionId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id).nullable().optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional()
}).strict();

const UpdateLiveArtifactInputSchema = z.object({
  artifactId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id),
  title: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.title, 1).optional(),
  description: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.description).nullable().optional()
}).strict().refine(
  (value) => value.title !== undefined || value.description !== undefined,
  "At least one update field is required"
);

type ListLiveArtifactsInput = z.infer<typeof ListLiveArtifactsInputSchema>;
type CreateLiveArtifactInput = z.infer<typeof LiveArtifactCreateInputSchema>;
type UpdateLiveArtifactInput = z.infer<typeof UpdateLiveArtifactInputSchema>;

interface LiveArtifactToolDefinitionOptions {
  readonly chatStorage: ChatStorage;
  readonly runId: string;
  readonly sessionId: string;
}

const liveArtifactToolMetadata = [
  {
    name: "list_live_artifacts",
    description: "Lists persisted Live Artifacts. This is read-only and does not require confirmation.",
    requiresConfirmation: false
  },
  {
    name: "create_live_artifact",
    description: "Creates a persisted Live Artifact as a sandboxed HTML page document with embedded JSON data. Always pass contentType='html_page_v1' and a document object; do not pass tile arrays or tile render JSON. For refreshable artifacts, put every connector/tool-derived value that may change in document.dataJson and bind it into sanitizedHtml with canonical forms like {{data.foo}}, data-bind=\"text:data.foo\", data-bind-attr=\"href:data.url\", data-bind-style=\"color:data.color\", and data-repeat=\"data.items\". Also set document.sourceJson.outputMapping.dataPaths to map dataJson fields to tool output paths, for example { stars: 'stargazers_count', owner: 'owner.login', repo: 'name' }. Do not hardcode refreshable values like stars, counts, statuses, names, or URLs directly into sanitizedHtml. Do not use <script> or window data injection for refreshable values; iframe scripts are sandboxed and will not run.",
    requiresConfirmation: false
  },
  {
    name: "update_live_artifact",
    description: "Updates a Live Artifact title or description.",
    requiresConfirmation: false
  }
] satisfies readonly [ToolMetadata, ToolMetadata, ToolMetadata];
const [listLiveArtifactsMetadata, createLiveArtifactMetadata, updateLiveArtifactMetadata] = liveArtifactToolMetadata;

function summarizeArtifact(artifact: LiveArtifact) {
  const artifactUrl = artifactUrlFor(artifact.id);

  return {
    id: artifact.id,
    url: artifactUrl,
    artifactUrl,
    title: artifact.title,
    description: artifact.description,
    status: artifact.status,
    pinned: artifact.pinned,
    refreshStatus: artifact.refreshStatus,
    contentType: artifact.contentType,
    updatedAt: artifact.updatedAt,
    lastRefreshedAt: artifact.lastRefreshedAt
  };
}

function summarizeProvenanceMetadata(artifact: LiveArtifactWithTiles) {
  const source = artifact.document?.sourceJson;
  const sources = source ? [{
    type: source.type,
    toolName: source.toolName,
    ...(source.connector !== undefined
      ? {
        connector: {
          connectorId: source.connector.connectorId,
          connectorName: source.connector.connectorName,
          accountLabel: source.connector.accountLabel,
          providerToolId: source.connector.providerToolId
        }
      }
      : {}),
  }] : [];

  return {
    createdByRunId: artifact.createdByRunId,
    createdByToolCallId: artifact.createdByToolCallId,
    hasDocument: artifact.document !== null,
    sourceCount: sources.length,
    sources: sources.slice(0, 10)
  };
}

function summarizeArtifactWithTiles(artifact: LiveArtifactWithTiles) {
  return {
    ...summarizeArtifact(artifact),
    hasDocument: artifact.document !== null
  };
}

export function createLiveArtifactToolDefinitions(
  options: LiveArtifactToolDefinitionOptions
): ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> {
  return [
    {
      metadata: {
        ...listLiveArtifactsMetadata
      },
      inputSchema: ListLiveArtifactsInputSchema,
      execute(input) {
        const parsed = ListLiveArtifactsInputSchema.parse(input) as ListLiveArtifactsInput;
        const artifacts = options.chatStorage.listLiveArtifacts({
          ...(parsed.includeArchived !== undefined ? { includeArchived: parsed.includeArchived } : {}),
          ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
          ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed.offset !== undefined ? { offset: parsed.offset } : {})
        }).map(summarizeArtifact);

        return {
          artifacts,
          count: artifacts.length
        };
      }
    },
    {
      metadata: {
        ...createLiveArtifactMetadata
      },
      inputSchema: LiveArtifactCreateInputSchema,
      execute(input, context) {
        const parsed = LiveArtifactCreateInputSchema.parse(input) as CreateLiveArtifactInput;
        const artifact = options.chatStorage.createLiveArtifact({
          ...parsed,
          sessionId: parsed.sessionId ?? options.sessionId,
          createdByRunId: options.runId,
          createdByToolCallId: context.persistedToolCallId
        });

        return {
          artifactId: artifact.id,
          artifactUrl: artifactUrlFor(artifact.id),
          provenance: summarizeProvenanceMetadata(artifact),
          artifact: summarizeArtifactWithTiles(artifact)
        };
      }
    },
    {
      metadata: {
        ...updateLiveArtifactMetadata
      },
      inputSchema: UpdateLiveArtifactInputSchema,
      execute(input) {
        const parsed = UpdateLiveArtifactInputSchema.parse(input) as UpdateLiveArtifactInput;
        const artifact = options.chatStorage.updateLiveArtifact(parsed.artifactId, {
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.description !== undefined ? { description: parsed.description } : {})
        });

        return {
          artifactId: artifact.id,
          artifactUrl: artifactUrlFor(artifact.id),
          provenance: summarizeProvenanceMetadata(artifact),
          artifact: summarizeArtifactWithTiles(artifact)
        };
      }
    }
  ];
}

export function createLiveArtifactToolSource(): ToolSource {
  return {
    id: "live-artifacts",
    listTools: () => liveArtifactToolMetadata,
    resolveTools: (context) => createLiveArtifactToolDefinitions({
      chatStorage: context.chatStorage,
      runId: context.runId,
      sessionId: context.sessionId
    })
  };
}
