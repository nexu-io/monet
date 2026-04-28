import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactCreateInputSchema,
  LiveArtifactSchema,
  LiveArtifactTileSchema,
  LiveArtifactWithTilesSchema,
  type LiveArtifact,
  type LiveArtifactTile,
  type LiveArtifactWithTiles
} from "../live-artifacts/schema";
import { refreshLiveArtifact } from "../live-artifacts/refresh";
import { createLogger } from "../logger";
import { ErrorResponseSchema, createErrorResponse } from "../openapi";
import type { SessionWorkspaceService } from "../session-workspace-service";
import type { ToolRegistry } from "../tools/registry";

const liveArtifactsLogger = createLogger("controller", {
  component: "live-artifacts-route"
});

const artifactIdParamSchema = z.object({
  artifactId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id).openapi({ example: "art_123" })
});

const tileRefreshParamSchema = artifactIdParamSchema.extend({
  tileId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id).openapi({ example: "til_123" })
});

const ListLiveArtifactsQuerySchema = z.object({
  includeArchived: z.enum(["true", "false"]).optional().openapi({ example: "false" }),
  sessionId: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.id).optional().openapi({ example: "ses_123" }),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .openapi({ example: "50" }),
  offset: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .openapi({ example: "0" })
});

const UpdateLiveArtifactRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.title).optional(),
    description: z.string().trim().min(1).max(LIVE_ARTIFACT_LIMITS.description).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    status: z.literal("archived").optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one update field is required")
  .refine(
    (value) => !(value.pinned === true && (value.archived === true || value.status === "archived")),
    "Archived artifacts cannot be pinned"
  )
  .openapi("UpdateLiveArtifactRequest");

const LiveArtifactSourceStateSchema = z.object({
  tileId: z.string(),
  tileTitle: z.string(),
  sourceType: z.enum(["tool", "connector_tool"]),
  toolName: z.string(),
  connectorId: z.string().nullable(),
  connectorName: z.string().nullable(),
  accountLabel: z.string().nullable(),
  providerToolId: z.string().nullable(),
  state: z.enum(["ok", "disconnected", "expired", "missing_connector", "stale_provider_tool"]),
  message: z.string()
}).openapi("LiveArtifactSourceState");

const ListLiveArtifactsResponseSchema = z
  .object({
    artifacts: z.array(LiveArtifactSchema.extend({
      sourceStates: z.array(LiveArtifactSourceStateSchema).optional()
    }))
  })
  .openapi("ListLiveArtifactsResponse");

const LiveArtifactDetailSchema = LiveArtifactWithTilesSchema.extend({
  sourceStates: z.array(LiveArtifactSourceStateSchema).optional(),
  tiles: z.array(z.intersection(LiveArtifactTileSchema, z.object({
    sourceState: LiveArtifactSourceStateSchema.optional()
  })))
});

const LiveArtifactResponseSchema = z
  .object({
    artifact: LiveArtifactDetailSchema
  })
  .openapi("LiveArtifactResponse");

const LiveArtifactRefreshFailureSchema = z.object({
  tileId: z.string().openapi({ example: "til_123" }),
  tileTitle: z.string().openapi({ example: "Recent invoices" }),
  toolName: z.string().openapi({ example: "stripe_list_invoices" }),
  error: z.string().openapi({ example: "Refresh tool is unavailable: stripe_list_invoices" })
});

const LiveArtifactRefreshResponseSchema = z
  .object({
    artifact: LiveArtifactDetailSchema,
    failures: z.array(LiveArtifactRefreshFailureSchema)
  })
  .openapi("LiveArtifactRefreshResponse");

const RefreshDisabledResponseSchema = ErrorResponseSchema.extend({
  disabled: z.literal(true).openapi({ example: true })
}).openapi("LiveArtifactRefreshDisabledResponse");

export const LIVE_ARTIFACT_REFRESH_PHASE_GATE = {
  enabled: true,
  errorCode: "refresh_disabled",
  message: "Live artifact refresh is disabled.",
  unmetPrerequisites: []
} as const;

const listLiveArtifactsRoute = createRoute({
  method: "get",
  path: "/api/live-artifacts",
  tags: ["Live Artifacts"],
  summary: "List live artifacts",
  description: "Returns persisted live artifacts ordered with pinned artifacts first.",
  request: {
    query: ListLiveArtifactsQuerySchema
  },
  responses: {
    200: {
      description: "Live artifacts fetched successfully.",
      content: {
        "application/json": {
          schema: ListLiveArtifactsResponseSchema
        }
      }
    },
    400: {
      description: "Query parameters are invalid.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const createLiveArtifactRoute = createRoute({
  method: "post",
  path: "/api/live-artifacts",
  tags: ["Live Artifacts"],
  summary: "Create live artifact",
  description: "Creates a persisted static live artifact with sanitized tile render JSON and source metadata.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: LiveArtifactCreateInputSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Live artifact created successfully.",
      content: {
        "application/json": {
          schema: LiveArtifactResponseSchema
        }
      }
    },
    400: {
      description: "Request body is invalid.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The live artifact could not be created.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const getLiveArtifactRoute = createRoute({
  method: "get",
  path: "/api/live-artifacts/{artifactId}",
  tags: ["Live Artifacts"],
  summary: "Get live artifact detail",
  description: "Returns a single live artifact and its tiles.",
  request: {
    params: artifactIdParamSchema
  },
  responses: {
    200: {
      description: "Live artifact fetched successfully.",
      content: {
        "application/json": {
          schema: LiveArtifactResponseSchema
        }
      }
    },
    404: {
      description: "The requested live artifact was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The live artifact could not be loaded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const updateLiveArtifactRoute = createRoute({
  method: "patch",
  path: "/api/live-artifacts/{artifactId}",
  tags: ["Live Artifacts"],
  summary: "Update live artifact",
  description: "Updates title/description, pinned state, or archives the artifact.",
  request: {
    params: artifactIdParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateLiveArtifactRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Live artifact updated successfully.",
      content: {
        "application/json": {
          schema: LiveArtifactResponseSchema
        }
      }
    },
    400: {
      description: "Request body is invalid.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: "The requested live artifact was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "The requested update conflicts with artifact state.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The live artifact could not be updated.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const refreshLiveArtifactRoute = createRoute({
  method: "post",
  path: "/api/live-artifacts/{artifactId}/refresh",
  tags: ["Live Artifacts"],
  summary: "Refresh live artifact",
  description:
    "Disabled by the Live Artifacts refresh phase gate until connector readiness gates pass. Static artifact creation, list, detail, update, pin, and archive remain available.",
  request: {
    params: artifactIdParamSchema
  },
  responses: {
    501: {
      description: "Live artifact refresh is not enabled in this increment.",
      content: {
        "application/json": {
          schema: RefreshDisabledResponseSchema
        }
      }
    },
    200: {
      description: "Live artifact refreshed successfully.",
      content: {
        "application/json": {
          schema: LiveArtifactRefreshResponseSchema
        }
      }
    },
    400: {
      description: "The live artifact could not be refreshed.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    404: {
      description: "The requested live artifact was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    409: {
      description: "A live artifact refresh is already in progress.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The live artifact refresh failed unexpectedly.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const refreshLiveArtifactTileRoute = createRoute({
  method: "post",
  path: "/api/live-artifacts/{artifactId}/tiles/{tileId}/refresh",
  tags: ["Live Artifacts"],
  summary: "Refresh live artifact tile",
  description:
    "Disabled by the Live Artifacts refresh phase gate until connector readiness gates pass. Static artifact creation, list, detail, update, pin, and archive remain available.",
  request: {
    params: tileRefreshParamSchema
  },
  responses: {
    501: {
      description: "Live artifact tile refresh is not enabled in this increment.",
      content: {
        "application/json": {
          schema: RefreshDisabledResponseSchema
        }
      }
    }
  }
});

function createRefreshDisabledResponse() {
  return {
    ...createErrorResponse(
      LIVE_ARTIFACT_REFRESH_PHASE_GATE.errorCode,
      LIVE_ARTIFACT_REFRESH_PHASE_GATE.message
    ),
    disabled: true as const
  };
}

type LiveArtifactSourceState = z.infer<typeof LiveArtifactSourceStateSchema>;
type LiveArtifactWithSourceStates = LiveArtifact & { sourceStates?: LiveArtifactSourceState[] };
type LiveArtifactTileWithSourceState = LiveArtifactTile & { sourceState?: LiveArtifactSourceState };
type LiveArtifactDetailWithSourceStates = Omit<LiveArtifactWithTiles, "tiles"> & {
  sourceStates?: LiveArtifactSourceState[];
  tiles: LiveArtifactTileWithSourceState[];
};

async function resolveLiveArtifactSourceStates(options: {
  readonly artifacts: readonly LiveArtifactWithTiles[];
  readonly chatStorage: ChatStorage;
  readonly toolRegistry: ToolRegistry | undefined;
  readonly sessionWorkspaceService: SessionWorkspaceService | undefined;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<Map<string, LiveArtifactSourceState[]>> {
  const connectorTiles = options.artifacts.flatMap((artifact) =>
    artifact.tiles
      .filter((tile) => tile.sourceJson?.type === "connector_tool")
      .map((tile) => ({ artifact, tile, source: tile.sourceJson! }))
  );

  const statesByArtifactId = new Map<string, LiveArtifactSourceState[]>();
  if (connectorTiles.length === 0) {
    return statesByArtifactId;
  }

  if (!options.toolRegistry || !options.sessionWorkspaceService) {
    for (const { artifact, tile, source } of connectorTiles) {
      addSourceState(statesByArtifactId, artifact.id, createSourceState(tile, "missing_connector", "Connector status is unavailable in this controller.", null));
    }
    return statesByArtifactId;
  }

  let definitions: Awaited<ReturnType<ToolRegistry["resolveTools"]>>;
  try {
    const sessionWorkspacePath = await options.sessionWorkspaceService.ensureWorkspace("ses_liveartifactstatus");
    definitions = await options.toolRegistry.resolveTools({
      runId: "live_artifact_status",
      sessionId: "ses_liveartifactstatus",
      sessionWorkspacePath,
      chatStorage: options.chatStorage,
      logger: liveArtifactsLogger,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {})
    });
  } catch (error) {
    liveArtifactsLogger.warn("live_artifacts.source_state_resolution_failed", {
      error: error instanceof Error ? error.message : "unknown"
    });
    for (const { artifact, tile } of connectorTiles) {
      addSourceState(statesByArtifactId, artifact.id, createSourceState(tile, "missing_connector", "Connector status could not be checked.", null));
    }
    return statesByArtifactId;
  }

  const definitionsByName = new Map(definitions.map((definition) => [definition.metadata.name, definition]));
  const connectorIds = new Set(definitions.map((definition) => definition.metadata.connector?.connectorId).filter((id): id is string => Boolean(id)));

  for (const { artifact, tile, source } of connectorTiles) {
    const storedConnector = source.connector;
    const definition = definitionsByName.get(source.toolName);
    const currentConnector = definition?.metadata.connector;

    if (!storedConnector || !connectorIds.has(storedConnector.connectorId)) {
      addSourceState(statesByArtifactId, artifact.id, createSourceState(tile, "missing_connector", "This connector is no longer available.", currentConnector ?? null));
      continue;
    }

    if (!definition || !currentConnector || currentConnector.connectorId !== storedConnector.connectorId || currentConnector.providerToolId !== storedConnector.providerToolId) {
      addSourceState(statesByArtifactId, artifact.id, createSourceState(tile, "stale_provider_tool", "The saved provider tool no longer matches the current connector catalog.", currentConnector ?? null));
      continue;
    }

    if (!storedConnector.accountLabel || !currentConnector.accountLabel || storedConnector.accountLabel !== currentConnector.accountLabel) {
      addSourceState(
        statesByArtifactId,
        artifact.id,
        createSourceState(tile, "disconnected", "The saved connector account no longer matches the connected account. Reconnect or recreate this source.", currentConnector)
      );
      continue;
    }

    if (currentConnector.connected !== true || currentConnector.connectionState !== "connected") {
      const isExpired = currentConnector.connectionState === "expired";
      addSourceState(
        statesByArtifactId,
        artifact.id,
        createSourceState(
          tile,
          isExpired ? "expired" : "disconnected",
          isExpired ? "The connector account has expired. Reconnect it to refresh this tile." : "The connector account is disconnected. Reconnect it to refresh this tile.",
          currentConnector
        )
      );
      continue;
    }

    addSourceState(statesByArtifactId, artifact.id, createSourceState(tile, "ok", "Connector source is connected and current.", currentConnector));
  }

  return statesByArtifactId;
}

function addSourceState(statesByArtifactId: Map<string, LiveArtifactSourceState[]>, artifactId: string, sourceState: LiveArtifactSourceState) {
  const states = statesByArtifactId.get(artifactId) ?? [];
  states.push(sourceState);
  statesByArtifactId.set(artifactId, states);
}

function createSourceState(
  tile: LiveArtifactTile,
  state: LiveArtifactSourceState["state"],
  message: string,
  currentConnector: { readonly accountLabel: string | null; readonly providerToolId: string; readonly connectorName: string; readonly connectorId: string } | null
): LiveArtifactSourceState {
  const source = tile.sourceJson;
  const storedConnector = source?.connector;

  return {
    tileId: tile.id,
    tileTitle: tile.title,
    sourceType: source?.type ?? "tool",
    toolName: source?.toolName ?? "unknown",
    connectorId: storedConnector?.connectorId ?? currentConnector?.connectorId ?? null,
    connectorName: storedConnector?.connectorName ?? currentConnector?.connectorName ?? null,
    accountLabel: currentConnector?.accountLabel ?? storedConnector?.accountLabel ?? null,
    providerToolId: storedConnector?.providerToolId ?? currentConnector?.providerToolId ?? null,
    state,
    message
  };
}

function attachSourceStatesToSummary(artifact: LiveArtifactWithTiles, states: LiveArtifactSourceState[] | undefined): LiveArtifactWithSourceStates {
  const { tiles: _tiles, ...summary } = artifact;
  return states && states.length > 0 ? { ...summary, sourceStates: states } : summary;
}

function attachSourceStatesToDetail(artifact: LiveArtifactWithTiles, states: LiveArtifactSourceState[] | undefined): LiveArtifactDetailWithSourceStates {
  if (!states || states.length === 0) {
    return artifact;
  }

  const statesByTileId = new Map(states.map((state) => [state.tileId, state]));
  return {
    ...artifact,
    sourceStates: states,
    tiles: artifact.tiles.map((tile) => {
      const sourceState = statesByTileId.get(tile.id);
      return sourceState ? { ...tile, sourceState } : tile;
    })
  };
}

async function attachCurrentSourceStatesToDetail(input: {
  readonly artifact: LiveArtifactWithTiles;
  readonly chatStorage: ChatStorage;
  readonly toolRegistry: ToolRegistry | undefined;
  readonly sessionWorkspaceService: SessionWorkspaceService | undefined;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<LiveArtifactDetailWithSourceStates> {
  const statesByArtifactId = await resolveLiveArtifactSourceStates({
    artifacts: [input.artifact],
    chatStorage: input.chatStorage,
    toolRegistry: input.toolRegistry,
    sessionWorkspaceService: input.sessionWorkspaceService,
    abortSignal: input.abortSignal
  });

  return attachSourceStatesToDetail(input.artifact, statesByArtifactId.get(input.artifact.id));
}

export function registerLiveArtifactRoutes(app: ControllerApp, options: {
  getChatStorage: () => ChatStorage;
  toolRegistry?: ToolRegistry;
  sessionWorkspaceService?: SessionWorkspaceService;
}) {
  app.openapi(listLiveArtifactsRoute, async (context) => {
    const query = context.req.valid("query");
    const listInput = {
      includeArchived: query.includeArchived === "true",
      ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
      ...(query.limit !== undefined ? { limit: Number.parseInt(query.limit, 10) } : {}),
      ...(query.offset !== undefined ? { offset: Number.parseInt(query.offset, 10) } : {})
    };

    const chatStorage = options.getChatStorage();
    const artifacts = chatStorage.listLiveArtifacts(listInput).map((artifact) => chatStorage.getLiveArtifact(artifact.id));
    const statesByArtifactId = await resolveLiveArtifactSourceStates({
      artifacts,
      chatStorage,
      toolRegistry: options.toolRegistry,
      sessionWorkspaceService: options.sessionWorkspaceService,
      abortSignal: context.req.raw.signal
    });

    return context.json({
      artifacts: artifacts.map((artifact) => attachSourceStatesToSummary(artifact, statesByArtifactId.get(artifact.id)))
    }, 200);
  });

  app.openapi(createLiveArtifactRoute, (context) => {
    try {
      const artifact = options.getChatStorage().createLiveArtifact(context.req.valid("json"));

      return context.json({ artifact }, 201);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        return context.json(createErrorResponse(error.errorCode, error.message), 400);
      }

      liveArtifactsLogger.error("live_artifacts.create_failed", error);

      return context.json(createErrorResponse("internal_error", "Failed to process the live artifact request."), 500);
    }
  });

  app.openapi(getLiveArtifactRoute, async (context) => {
    try {
      const chatStorage = options.getChatStorage();
      const artifact = chatStorage.getLiveArtifact(context.req.valid("param").artifactId);
      const artifactWithSourceStates = await attachCurrentSourceStatesToDetail({
        artifact,
        chatStorage,
        toolRegistry: options.toolRegistry,
        sessionWorkspaceService: options.sessionWorkspaceService,
        abortSignal: context.req.raw.signal
      });

      return context.json({ artifact: artifactWithSourceStates }, 200);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError && error.statusCode === 404) {
        return context.json(createErrorResponse(error.errorCode, error.message), 404);
      }

      liveArtifactsLogger.error("live_artifacts.lookup_failed", error);

      return context.json(createErrorResponse("internal_error", "Failed to process the live artifact request."), 500);
    }
  });

  app.openapi(updateLiveArtifactRoute, async (context) => {
    const artifactId = context.req.valid("param").artifactId;
    const payload = context.req.valid("json");

    try {
      let artifact =
        payload.title !== undefined || payload.description !== undefined
          ? options.getChatStorage().updateLiveArtifact(artifactId, {
              ...(payload.title !== undefined ? { title: payload.title } : {}),
              ...(payload.description !== undefined ? { description: payload.description } : {})
            })
          : options.getChatStorage().getLiveArtifact(artifactId);

      if (payload.archived === true || payload.status === "archived") {
        artifact = options.getChatStorage().archiveLiveArtifact(artifactId);
      } else if (payload.pinned !== undefined) {
        artifact = options.getChatStorage().pinLiveArtifact(artifactId, payload.pinned);
      }

      const chatStorage = options.getChatStorage();
      const artifactWithSourceStates = await attachCurrentSourceStatesToDetail({
        artifact,
        chatStorage,
        toolRegistry: options.toolRegistry,
        sessionWorkspaceService: options.sessionWorkspaceService,
        abortSignal: context.req.raw.signal
      });

      return context.json({ artifact: artifactWithSourceStates }, 200);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        if (error.statusCode === 404) {
          return context.json(createErrorResponse(error.errorCode, error.message), 404);
        }

        if (error.statusCode === 409) {
          return context.json(createErrorResponse(error.errorCode, error.message), 409);
        }

        return context.json(createErrorResponse(error.errorCode, error.message), 400);
      }

      liveArtifactsLogger.error("live_artifacts.update_failed", error);

      return context.json(createErrorResponse("internal_error", "Failed to process the live artifact request."), 500);
    }
  });

  app.openapi(refreshLiveArtifactRoute, async (context) => {
    const { artifactId } = context.req.valid("param");

    if (!LIVE_ARTIFACT_REFRESH_PHASE_GATE.enabled || !options.toolRegistry || !options.sessionWorkspaceService) {
      return context.json(createRefreshDisabledResponse(), 501);
    }

    try {
      const artifact = options.getChatStorage().getLiveArtifact(artifactId);
      const sessionId = artifact.sessionId ?? "ses_liveartifactrefresh";
      const sessionWorkspacePath = await options.sessionWorkspaceService.ensureWorkspace(sessionId);
      const result = await refreshLiveArtifact({
        artifactId,
        chatStorage: options.getChatStorage(),
        toolRegistry: options.toolRegistry,
        sessionWorkspacePath,
        logger: liveArtifactsLogger,
        abortSignal: context.req.raw.signal
      });
      const artifactWithSourceStates = await attachCurrentSourceStatesToDetail({
        artifact: result.artifact,
        chatStorage: options.getChatStorage(),
        toolRegistry: options.toolRegistry,
        sessionWorkspaceService: options.sessionWorkspaceService,
        abortSignal: context.req.raw.signal
      });

      return context.json({ artifact: artifactWithSourceStates, failures: [...result.failures] }, 200);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        if (error.statusCode === 404) {
          return context.json(createErrorResponse(error.errorCode, error.message), 404);
        }

        if (error.statusCode === 409) {
          return context.json(createErrorResponse(error.errorCode, error.message), 409);
        }

        return context.json(createErrorResponse(error.errorCode, error.message), 400);
      }

      liveArtifactsLogger.error("live_artifacts.refresh_failed", error);

      return context.json(
        createErrorResponse("refresh_failed", error instanceof Error ? error.message : "Failed to refresh live artifact."),
        400
      );
    }
  });

  app.openapi(refreshLiveArtifactTileRoute, (context) => {
    void context.req.valid("param");

    return context.json(createRefreshDisabledResponse(), 501);
  });
}
