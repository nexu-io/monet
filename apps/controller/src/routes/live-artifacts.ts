import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";
import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactCreateInputSchema,
  LiveArtifactSchema,
  LiveArtifactWithTilesSchema
} from "../live-artifacts/schema";
import { createLogger } from "../logger";
import { ErrorResponseSchema, createErrorResponse } from "../openapi";

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

const ListLiveArtifactsResponseSchema = z
  .object({
    artifacts: z.array(LiveArtifactSchema)
  })
  .openapi("ListLiveArtifactsResponse");

const LiveArtifactResponseSchema = z
  .object({
    artifact: LiveArtifactWithTilesSchema
  })
  .openapi("LiveArtifactResponse");

const RefreshDisabledResponseSchema = ErrorResponseSchema.extend({
  disabled: z.literal(true).openapi({ example: true })
}).openapi("LiveArtifactRefreshDisabledResponse");

export const LIVE_ARTIFACT_REFRESH_PHASE_GATE = {
  enabled: false,
  errorCode: "refresh_disabled",
  message:
    "Live artifact refresh is disabled until connector readiness gates pass; this increment supports static artifact creation, listing, detail, update, pin, and archive only.",
  unmetPrerequisites: ["stable_connected_account_labels"]
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

export function registerLiveArtifactRoutes(app: ControllerApp, options: { getChatStorage: () => ChatStorage }) {
  app.openapi(listLiveArtifactsRoute, (context) => {
    const query = context.req.valid("query");
    const listInput = {
      includeArchived: query.includeArchived === "true",
      ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
      ...(query.limit !== undefined ? { limit: Number.parseInt(query.limit, 10) } : {}),
      ...(query.offset !== undefined ? { offset: Number.parseInt(query.offset, 10) } : {})
    };

    return context.json(
      {
        artifacts: options.getChatStorage().listLiveArtifacts(listInput)
      },
      200
    );
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

  app.openapi(getLiveArtifactRoute, (context) => {
    try {
      const artifact = options.getChatStorage().getLiveArtifact(context.req.valid("param").artifactId);

      return context.json({ artifact }, 200);
    } catch (error) {
      if (error instanceof ChatStorageResolutionError && error.statusCode === 404) {
        return context.json(createErrorResponse(error.errorCode, error.message), 404);
      }

      liveArtifactsLogger.error("live_artifacts.lookup_failed", error);

      return context.json(createErrorResponse("internal_error", "Failed to process the live artifact request."), 500);
    }
  });

  app.openapi(updateLiveArtifactRoute, (context) => {
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

      return context.json({ artifact }, 200);
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

  app.openapi(refreshLiveArtifactRoute, (context) => {
    void context.req.valid("param");

    return context.json(createRefreshDisabledResponse(), 501);
  });

  app.openapi(refreshLiveArtifactTileRoute, (context) => {
    void context.req.valid("param");

    return context.json(createRefreshDisabledResponse(), 501);
  });
}
