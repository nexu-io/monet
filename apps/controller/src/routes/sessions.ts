import { createRoute, z } from "@hono/zod-openapi";

import type { ControllerApp } from "../app";
import {
  ArchiveSessionResponseSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  ListSessionsResponseSchema,
  SessionDetailSchema,
  SessionSchema,
  UpdateSessionRequestSchema,
  createErrorResponse
} from "../openapi";
import { ChatStorageResolutionError, type ChatStorage } from "../chat-storage";

const sessionIdParamSchema = z.object({
  sessionId: z.string().openapi({ example: "ses_123" })
});

const listSessionsRoute = createRoute({
  method: "get",
  path: "/api/sessions",
  tags: ["Sessions"],
  summary: "List sessions",
  description: "Returns persisted sessions ordered by recent activity.",
  responses: {
    200: {
      description: "Sessions fetched successfully.",
      content: {
        "application/json": {
          schema: ListSessionsResponseSchema
        }
      }
    }
  }
});

const createSessionRoute = createRoute({
  method: "post",
  path: "/api/sessions",
  tags: ["Sessions"],
  summary: "Create session",
  description: "Creates a blank session with optional provider and model defaults.",
  request: {
    body: {
      required: false,
      content: {
        "application/json": {
          schema: CreateSessionRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Session created successfully.",
      content: {
        "application/json": {
          schema: SessionSchema
        }
      }
    },
    400: {
      description: "Request body or provider/model selection is invalid.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    422: {
      description: "The requested provider could not resolve a model.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The session could not be created.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const getSessionDetailRoute = createRoute({
  method: "get",
  path: "/api/sessions/{sessionId}",
  tags: ["Sessions"],
  summary: "Get session detail",
  description: "Returns a single session and its persisted message history.",
  request: {
    params: sessionIdParamSchema
  },
  responses: {
    200: {
      description: "Session detail fetched successfully.",
      content: {
        "application/json": {
          schema: SessionDetailSchema
        }
      }
    },
    404: {
      description: "The requested session was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The session detail could not be loaded.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const updateSessionRoute = createRoute({
  method: "patch",
  path: "/api/sessions/{sessionId}",
  tags: ["Sessions"],
  summary: "Update session",
  description: "Updates mutable session fields such as the title.",
  request: {
    params: sessionIdParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateSessionRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: "Session updated successfully.",
      content: {
        "application/json": {
          schema: SessionSchema
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
      description: "The requested session was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The session could not be updated.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

const archiveSessionRoute = createRoute({
  method: "post",
  path: "/api/sessions/{sessionId}/archive",
  tags: ["Sessions"],
  summary: "Archive session",
  description: "Marks a session as archived without deleting its history.",
  request: {
    params: sessionIdParamSchema
  },
  responses: {
    200: {
      description: "Session archived successfully.",
      content: {
        "application/json": {
          schema: ArchiveSessionResponseSchema
        }
      }
    },
    404: {
      description: "The requested session was not found.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    },
    500: {
      description: "The session could not be archived.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

function createSessionMutationErrorResponse(error: unknown) {
  if (error instanceof ChatStorageResolutionError) {
    if (error.statusCode === 422) {
      return {
        body: createErrorResponse(error.errorCode, error.message),
        status: 422 as const
      };
    }

    return {
      body: createErrorResponse(error.errorCode, error.message),
      status: 400 as const
    } as const;
  }

  console.error("Sessions route failed.", error);

  return {
    body: createErrorResponse("internal_error", "Failed to process the session request."),
    status: 500 as const
  } as const;
}

function createSessionLookupErrorResponse(error: unknown) {
  if (error instanceof ChatStorageResolutionError && error.statusCode === 404) {
    return {
      body: createErrorResponse(error.errorCode, error.message),
      status: 404 as const
    };
  }

  console.error("Sessions route failed.", error);

  return {
    body: createErrorResponse("internal_error", "Failed to process the session request."),
    status: 500 as const
  };
}

export function registerSessionRoutes(app: ControllerApp, options: { getChatStorage: () => ChatStorage }) {
  app.openapi(listSessionsRoute, (context) => {
    return context.json(
      {
        sessions: options.getChatStorage().listSessions()
      },
      200
    );
  });

  app.openapi(createSessionRoute, async (context) => {
    let payload: unknown = {};

    try {
      payload = await context.req.json();
    } catch {
      payload = {};
    }

    const parsedBody = CreateSessionRequestSchema.safeParse(payload);

    if (!parsedBody.success) {
      return context.json(createErrorResponse("invalid_request", "Request validation failed."), 400);
    }

    const input = {
      ...(parsedBody.data.title ? { title: parsedBody.data.title } : {}),
      ...(parsedBody.data.providerId ? { providerId: parsedBody.data.providerId } : {}),
      ...(parsedBody.data.modelId ? { modelId: parsedBody.data.modelId } : {})
    };

    try {
      const session = options.getChatStorage().createSession(input);

      return context.json(session, 201);
    } catch (error) {
      const response = createSessionMutationErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(getSessionDetailRoute, (context) => {
    try {
      return context.json(options.getChatStorage().getSessionDetail(context.req.valid("param").sessionId), 200);
    } catch (error) {
      const response = createSessionLookupErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(updateSessionRoute, async (context) => {
    let payload: unknown = {};

    try {
      payload = await context.req.json();
    } catch {
      payload = {};
    }

    const parsedBody = UpdateSessionRequestSchema.safeParse(payload);

    if (!parsedBody.success) {
      return context.json(createErrorResponse("invalid_request", "Request validation failed."), 400);
    }

    try {
      return context.json(
        options.getChatStorage().updateSessionTitle({
          sessionId: context.req.valid("param").sessionId,
          title: parsedBody.data.title
        }),
        200
      );
    } catch (error) {
      const response = createSessionLookupErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });

  app.openapi(archiveSessionRoute, (context) => {
    try {
      return context.json(
        {
          session: options.getChatStorage().archiveSession(context.req.valid("param").sessionId)
        },
        200
      );
    } catch (error) {
      const response = createSessionLookupErrorResponse(error);

      return context.json(response.body, response.status);
    }
  });
}
