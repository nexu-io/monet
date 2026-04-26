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
    defaultProviderId: z.string().nullable().openapi({ example: null }),
    defaultModelId: z.string().nullable().openapi({ example: null })
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
    id: z.string().openapi({ example: "pro_123" }),
    type: z.enum(["openai", "openrouter"]).openapi({ example: "openai" }),
    displayName: z.string().openapi({ example: "Provider" }),
    baseUrl: z.string().url().nullable().openapi({ example: null }),
    defaultModelName: z.string().nullable().openapi({ example: null }),
    enabled: z.boolean().openapi({ example: true }),
    timeoutMs: z.number().int().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" })
  })
  .openapi("Provider");

export const ProviderModelSchema = z
  .object({
    id: z.string().openapi({ example: "mod_123" }),
    providerId: z.string().openapi({ example: "pro_123" }),
    modelName: z.string().openapi({ example: "model-name" }),
    displayName: z.string().openapi({ example: "Model name" }),
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
    defaultModelId: z.string().nullable().openapi({ example: null }),
    defaultModelName: z.string().nullable().openapi({ example: null }),
    availableModelCount: z.number().int().nonnegative().openapi({ example: 0 })
  })
  .openapi("ValidateProviderResponse");

export const AuthorizedDirectorySchema = z
  .object({
    path: z.string().openapi({ example: "/Users/example/Projects/monet" }),
    createdAt: z.string().datetime().openapi({ example: "2026-04-23T10:00:00.000Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2026-04-23T10:05:00.000Z" })
  })
  .openapi("AuthorizedDirectory");

export const ListAuthorizedDirectoriesResponseSchema = z
  .object({
    authorizedDirectories: z.array(AuthorizedDirectorySchema)
  })
  .openapi("ListAuthorizedDirectoriesResponse");

export const ReplaceAuthorizedDirectoriesRequestSchema = z
  .object({
    paths: z.array(z.string().trim().min(1)).max(100)
  })
  .openapi("ReplaceAuthorizedDirectoriesRequest");

export const ToolSchema = z
  .object({
    name: z.string().openapi({ example: "read_file" }),
    description: z.string().openapi({ example: "Reads a UTF-8 text file from an authorized directory." }),
    requiresConfirmation: z.boolean().openapi({ example: true })
  })
  .openapi("Tool");

export const ListToolsResponseSchema = z
  .object({
    tools: z.array(ToolSchema)
  })
  .openapi("ListToolsResponse");

export const ToolApprovalDecisionSchema = z.enum(["approved", "rejected"]).openapi("ToolApprovalDecision");

export const ConfirmToolRequestSchema = z
  .object({
    runId: z.string().openapi({ example: "run_123" }),
    toolCallId: z.string().openapi({ example: "call_123" }),
    decision: ToolApprovalDecisionSchema.openapi({ example: "approved" }),
    confirmationToken: z.string().openapi({ example: "opaque-token-from-server" })
  })
  .openapi("ConfirmToolRequest");

export const ConfirmToolResponseSchema = z
  .object({
    ok: z.literal(true).openapi({ example: true })
  })
  .openapi("ConfirmToolResponse");

export const StopRunResponseSchema = z
  .object({
    ok: z.literal(true).openapi({ example: true })
  })
  .openapi("StopRunResponse");

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createErrorResponse(error: string, message: string): ErrorResponse {
  return {
    error,
    message
  };
}
