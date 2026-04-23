import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "unauthorized" }),
    message: z.string().openapi({ example: "Missing or invalid bearer token." })
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok").openapi({ example: "ok" }),
    service: z.literal("controller").openapi({ example: "controller" }),
    version: z.string().openapi({ example: "0.1.0" })
  })
  .openapi("HealthResponse");

export const SessionSchema = z
  .object({
    id: z.string().openapi({ example: "ses_123" }),
    title: z.string().openapi({ example: "New chat" }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-23T10:05:00.000Z" }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    defaultProviderId: z.string().nullable().openapi({ example: "pro_local-stub" }),
    defaultModelId: z.string().nullable().openapi({ example: "mod_controller-echo" })
  })
  .openapi("Session");

export const SessionMessageSchema = z
  .object({
    id: z.string().openapi({ example: "msg_123" }),
    sessionId: z.string().openapi({ example: "ses_123" }),
    runId: z.string().nullable().openapi({ example: "run_123" }),
    role: z.string().openapi({ example: "user" }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:05:00.000Z" }),
    uiMessage: z.unknown().openapi({
      example: {
        id: "msg_123",
        role: "user",
        parts: [{ type: "text", text: "Hello" }]
      }
    })
  })
  .openapi("SessionMessage");

export const SessionDetailSchema = SessionSchema.extend({
  messages: z.array(SessionMessageSchema)
}).openapi("SessionDetail");

export const ListSessionsResponseSchema = z
  .object({
    sessions: z.array(SessionSchema)
  })
  .openapi("ListSessionsResponse");

export const CreateSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    providerId: z.string().trim().min(1).optional(),
    modelId: z.string().trim().min(1).optional()
  })
  .openapi("CreateSessionRequest");

export const ArchiveSessionResponseSchema = z
  .object({
    session: SessionSchema
  })
  .openapi("ArchiveSessionResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createErrorResponse(error: string, message: string): ErrorResponse {
  return {
    error,
    message
  };
}
