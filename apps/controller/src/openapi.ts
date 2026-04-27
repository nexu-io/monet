import { z } from "@hono/zod-openapi";

import { CONNECTOR_PROVIDER_ERROR_CODES } from "./connectors/errors";

export const ConnectorProviderErrorCodeSchema = z.enum(CONNECTOR_PROVIDER_ERROR_CODES).openapi("ConnectorProviderErrorCode");

export const ConnectorToolPolicySchema = z
  .object({
    sideEffect: z.enum(["read", "write", "destructive", "external_send"]).openapi({ example: "read" }),
    approval: z.enum(["never", "first_use", "always"]).openapi({ example: "first_use" })
  })
  .openapi("ConnectorToolPolicy");

export const ConnectorStatusSchema = z
  .enum(["unavailable", "not_connected", "connected", "expired"])
  .openapi("ConnectorStatus");

export const ConnectorCatalogCardSchema = z
  .object({
    id: z.enum(["github", "notion", "google_drive"]).openapi({ example: "github" }),
    displayName: z.string().openapi({ example: "GitHub" }),
    description: z.string().openapi({ example: "Search repositories, issues, pull requests, commits, and releases." }),
    category: z.enum(["developer", "productivity", "files"]).openapi({ example: "developer" }),
    icon: z.string().openapi({ example: "github" }),
    featuredTools: z.array(z.string()).openapi({ example: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS"] }),
    enabledByDefault: z.boolean().openapi({ example: true }),
    minimumApprovalPolicy: ConnectorToolPolicySchema,
    capabilitySummaries: z.array(z.string()).openapi({ example: ["Search and list repositories."] }),
    status: ConnectorStatusSchema.openapi({ example: "not_connected" }),
    connectedAccountLabel: z.string().optional().openapi({ example: "octocat" }),
    lastErrorCode: ConnectorProviderErrorCodeSchema.optional().openapi({ example: "provider_error" }),
    lastErrorMessage: z.string().optional().openapi({ example: "Connector provider is not configured." })
  })
  .openapi("ConnectorCatalogCard");

export const ConnectorAccountMetadataSchema = z
  .object({
    accountLabel: z.string().optional().openapi({ example: "octocat" }),
    accountId: z.string().optional().openapi({ example: "123456" }),
    providerConnectionId: z.string().optional().openapi({ example: "conn_123" }),
    providerConnectorId: z.string().optional().openapi({ example: "GITHUB" }),
    connectedAt: z.string().datetime().optional().openapi({ example: "2026-04-27T10:00:00.000Z" }),
    updatedAt: z.string().datetime().optional().openapi({ example: "2026-04-27T10:05:00.000Z" })
  })
  .openapi("ConnectorAccountMetadata");

export const ConnectorServiceConnectionSchema = z
  .object({
    status: ConnectorStatusSchema.openapi({ example: "connected" }),
    connected: z.boolean().openapi({ example: true }),
    connectedAccountLabel: z.string().optional().openapi({ example: "octocat" }),
    account: ConnectorAccountMetadataSchema.optional(),
    lastErrorCode: ConnectorProviderErrorCodeSchema.optional().openapi({ example: "connection_expired" }),
    lastErrorMessage: z.string().optional().openapi({ example: "Connector account credentials have expired." })
  })
  .openapi("ConnectorServiceConnection");

export const ConnectorAllowedToolSchema = z
  .object({
    providerToolId: z.string().openapi({ example: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS" }),
    displayName: z.string().openapi({ example: "Search issues and pull requests" }),
    summary: z.string().openapi({ example: "Search issues and pull requests across accessible repositories." }),
    policy: ConnectorToolPolicySchema
  })
  .openapi("ConnectorAllowedTool");

export const ConnectorDetailSchema = ConnectorCatalogCardSchema.extend({
  providerConnectorId: z.string().openapi({ example: "GITHUB" }),
  connection: ConnectorServiceConnectionSchema,
  allowedTools: z.array(ConnectorAllowedToolSchema)
}).openapi("ConnectorDetail");

export const ListConnectorsResponseSchema = z
  .object({
    connectors: z.array(ConnectorCatalogCardSchema)
  })
  .openapi("ListConnectorsResponse");

export const GetConnectorResponseSchema = z
  .object({
    connector: ConnectorDetailSchema
  })
  .openapi("GetConnectorResponse");

export const StartConnectorConnectionRequestSchema = z
  .object({
    redirectUrl: z.string().url().optional().openapi({ example: "monet://connectors/callback" })
  })
  .openapi("StartConnectorConnectionRequest");

export const StartConnectorConnectionResponseSchema = z
  .object({
    status: z.enum(["redirect_required", "connected", "pending"]).openapi({ example: "redirect_required" }),
    connectorId: z.enum(["github", "notion", "google_drive"]).openapi({ example: "github" }),
    providerConnectionId: z.string().optional().openapi({ example: "conn_123" }),
    redirectUrl: z.string().url().optional().openapi({ example: "https://accounts.provider.example/oauth/authorize?..." }),
    expiresAt: z.string().datetime().optional().openapi({ example: "2026-04-27T10:05:00.000Z" })
  })
  .openapi("StartConnectorConnectionResponse");

export const DisconnectConnectorConnectionResponseSchema = z
  .object({
    connectorId: z.enum(["github", "notion", "google_drive"]).openapi({ example: "github" }),
    status: z.literal("not_connected").openapi({ example: "not_connected" })
  })
  .openapi("DisconnectConnectorConnectionResponse");

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
  workspacePath: z.string().nullable().openapi({
    example: "/Users/example/Library/Application Support/Monet/session-workspaces/ses_abc123/workspace"
  }),
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

export const OpenWorkspaceDirectoryResponseSchema = z
  .object({
    ok: z.literal(true).openapi({ example: true }),
    workspacePath: z.string().openapi({
      example: "/Users/example/Library/Application Support/Monet/session-workspaces/ses_abc123/workspace"
    })
  })
  .openapi("OpenWorkspaceDirectoryResponse");

export const ProviderSchema = z
  .object({
    id: z.string().openapi({ example: "pro_123" }),
    type: z.enum(["openai", "openrouter"]).openapi({ example: "openai" }),
    displayName: z.string().openapi({ example: "Provider" }),
    baseUrl: z.string().url().nullable().openapi({ example: null }),
    defaultModelName: z.string().nullable().openapi({ example: null }),
    enabled: z.boolean().openapi({ example: true }),
    timeoutMs: z.number().int().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: "2024-01-01T00:00:00Z" }),
    updatedAt: z.string().datetime().openapi({ example: "2024-01-01T00:00:00Z" })
  })
  .openapi("Provider");

export const CreateProviderRequestSchema = z
  .object({
    type: z.enum(["openai", "openrouter"]).openapi({ example: "openai" }),
    displayName: z.string().min(1).openapi({ example: "My OpenAI Provider" }),
    baseUrl: z.string().url().nullable().optional().openapi({ example: null }),
    timeoutMs: z.number().int().positive().nullable().optional().openapi({ example: null })
  })
  .openapi("CreateProviderRequest");

export const UpdateProviderRequestSchema = z
  .object({
    displayName: z.string().min(1).optional().openapi({ example: "My OpenAI Provider" }),
    baseUrl: z.string().url().nullable().optional().openapi({ example: null }),
    timeoutMs: z.number().int().positive().nullable().optional().openapi({ example: null })
  })
  .openapi("UpdateProviderRequest");

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

export const UpdateProviderModelRequestSchema = z
  .object({
    enabled: z.boolean().openapi({ example: true })
  })
  .openapi("UpdateProviderModelRequest");

export const CreateProviderModelRequestSchema = z
  .object({
    modelName: z.string().trim().min(1).max(300).openapi({ example: "gpt-4.1-mini" }),
    displayName: z.string().trim().min(1).max(300).optional().openapi({ example: "GPT 4.1 Mini" }),
    supportsTools: z.boolean().optional().openapi({ example: true }),
    supportsReasoning: z.boolean().optional().openapi({ example: false })
  })
  .openapi("CreateProviderModelRequest");

export const CreateProviderModelWithProviderRequestSchema = CreateProviderModelRequestSchema.extend({
  providerId: z.string().trim().min(1).openapi({ example: "pro_123" })
}).openapi("CreateProviderModelWithProviderRequest");

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
