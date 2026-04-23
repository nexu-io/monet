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
    defaultProviderId: z.string().nullable().openapi({ example: "pro_b6m4q2r8t5v9x3z7k1n4p6s8" }),
    defaultModelId: z.string().nullable().openapi({ example: "mod_c7n5r3t9w2y6k4m8p1s5v7x9" })
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

export const UpdateSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200)
  })
  .openapi("UpdateSessionRequest");

export const ArchiveSessionResponseSchema = z
  .object({
    session: SessionSchema
  })
  .openapi("ArchiveSessionResponse");

export const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: "pro_b6m4q2r8t5v9x3z7k1n4p6s8" }),
    type: z.enum(["openai", "openrouter"]).openapi({ example: "openai" }),
    displayName: z.string().openapi({ example: "Local Stub Provider" }),
    baseUrl: z.string().url().nullable().openapi({ example: null }),
    defaultModelName: z.string().nullable().openapi({ example: "controller-echo" }),
    enabled: z.boolean().openapi({ example: true }),
    timeoutMs: z.number().int().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" })
  })
  .openapi("Provider");

export const ProviderModelSchema = z
  .object({
    id: z.string().openapi({ example: "mod_c7n5r3t9w2y6k4m8p1s5v7x9" }),
    providerId: z.string().openapi({ example: "pro_b6m4q2r8t5v9x3z7k1n4p6s8" }),
    modelName: z.string().openapi({ example: "controller-echo" }),
    displayName: z.string().openapi({ example: "Controller Echo" }),
    supportsTools: z.boolean().openapi({ example: false }),
    supportsReasoning: z.boolean().openapi({ example: false }),
    enabled: z.boolean().openapi({ example: true }),
    capabilitiesJson: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" })
  })
  .openapi("ProviderModel");

export const ListProvidersResponseSchema = z
  .object({
    providers: z.array(ProviderSchema)
  })
  .openapi("ListProvidersResponse");

export const ListModelsResponseSchema = z
  .object({
    models: z.array(ProviderModelSchema)
  })
  .openapi("ListModelsResponse");

export const ValidateProviderResponseSchema = z
  .object({
    provider: ProviderSchema,
    valid: z.boolean().openapi({ example: true }),
    reason: z
      .enum([
        "ok",
        "disabled",
        "no_enabled_models",
        "missing_default_model",
        "default_model_unresolved",
        "missing_credentials",
        "provider_api_error"
      ])
      .openapi({ example: "ok" }),
    message: z.string().openapi({ example: "Provider configuration is valid." }),
    defaultModelId: z.string().nullable().openapi({ example: "mod_c7n5r3t9w2y6k4m8p1s5v7x9" }),
    defaultModelName: z.string().nullable().openapi({ example: "controller-echo" }),
    availableModelCount: z.number().int().nonnegative().openapi({ example: 1 })
  })
  .openapi("ValidateProviderResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createErrorResponse(error: string, message: string): ErrorResponse {
  return {
    error,
    message
  };
}
