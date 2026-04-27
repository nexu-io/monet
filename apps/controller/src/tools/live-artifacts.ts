import { z } from "@hono/zod-openapi";

import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactCreateInputSchema,
  LiveArtifactCreateTileInputSchema,
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
  description: LiveArtifactSafeTextSchema(LIVE_ARTIFACT_LIMITS.description).nullable().optional(),
  tiles: z.array(LiveArtifactCreateTileInputSchema).min(1).max(50).optional()
}).strict().refine(
  (value) => value.title !== undefined || value.description !== undefined || value.tiles !== undefined,
  "At least one update field is required"
);

type ListLiveArtifactsInput = z.infer<typeof ListLiveArtifactsInputSchema>;
type CreateLiveArtifactInput = z.infer<typeof LiveArtifactCreateInputSchema>;
type UpdateLiveArtifactInput = z.infer<typeof UpdateLiveArtifactInputSchema>;

interface LiveArtifactToolDefinitionOptions {
  readonly chatStorage: ChatStorage;
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
    description: "Creates a persisted static Live Artifact from sanitized tile render JSON and optional source metadata.",
    requiresConfirmation: true
  },
  {
    name: "update_live_artifact",
    description: "Updates a Live Artifact title, description, or tile definitions. Title and description edits do not require confirmation; tile/source or refresh permission changes require confirmation.",
    requiresConfirmation: false
  }
] satisfies readonly [ToolMetadata, ToolMetadata, ToolMetadata];
const [listLiveArtifactsMetadata, createLiveArtifactMetadata, updateLiveArtifactMetadata] = liveArtifactToolMetadata;

function summarizeArtifact(artifact: LiveArtifact) {
  return {
    id: artifact.id,
    url: artifactUrlFor(artifact.id),
    title: artifact.title,
    description: artifact.description,
    status: artifact.status,
    pinned: artifact.pinned,
    refreshStatus: artifact.refreshStatus,
    updatedAt: artifact.updatedAt,
    lastRefreshedAt: artifact.lastRefreshedAt
  };
}

function summarizeArtifactWithTiles(artifact: LiveArtifactWithTiles) {
  return {
    ...summarizeArtifact(artifact),
    tileCount: artifact.tiles.length,
    tiles: artifact.tiles.map((tile) => ({
      id: tile.id,
      title: tile.title,
      kind: tile.kind,
      hasSource: tile.sourceJson !== null,
      refreshStatus: tile.refreshStatus,
      lastRefreshedAt: tile.lastRefreshedAt,
      lastError: tile.lastError
    }))
  };
}

function updateLiveArtifactNeedsApproval(input: UpdateLiveArtifactInput): boolean {
  return input.tiles !== undefined;
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
      execute(input) {
        const parsed = LiveArtifactCreateInputSchema.parse(input) as CreateLiveArtifactInput;
        const artifact = options.chatStorage.createLiveArtifact({
          ...parsed,
          sessionId: parsed.sessionId ?? options.sessionId
        });

        return {
          artifact: summarizeArtifactWithTiles(artifact)
        };
      }
    },
    {
      metadata: {
        ...updateLiveArtifactMetadata
      },
      inputSchema: UpdateLiveArtifactInputSchema,
      needsApproval(input) {
        const parsed = UpdateLiveArtifactInputSchema.parse(input) as UpdateLiveArtifactInput;
        return updateLiveArtifactNeedsApproval(parsed);
      },
      execute(input) {
        const parsed = UpdateLiveArtifactInputSchema.parse(input) as UpdateLiveArtifactInput;
        const artifact = options.chatStorage.updateLiveArtifact(parsed.artifactId, {
          ...(parsed.title !== undefined ? { title: parsed.title } : {}),
          ...(parsed.description !== undefined ? { description: parsed.description } : {})
        });

        const updatedArtifact = parsed.tiles
          ? options.chatStorage.replaceLiveArtifactTiles({
            artifactId: parsed.artifactId,
            tiles: parsed.tiles
          })
          : artifact;

        return {
          artifact: summarizeArtifactWithTiles(updatedArtifact)
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
      sessionId: context.sessionId
    })
  };
}
