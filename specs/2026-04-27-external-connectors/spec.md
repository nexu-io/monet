# External Connectors Implementation Plan

## 1. Background

The initial MVP intentionally excluded a connector system so the app could first stabilize the core agent loop: chat, tool calls, approvals, persistence, and provider configuration. The next product step is to add external SaaS connectors that can expand an agent's practical capabilities without requiring users to manually copy data between apps.

This plan adds a **Connectors** product surface and a backend connector layer that can integrate with either **Composio** or **Pipedream** as the managed external-app provider.

Typical first connectors:

- GitHub
- Notion
- Google Drive
- Gmail / Google Calendar, if available through the chosen provider
- Slack, Linear, Jira, or similar follow-up connectors

## 2. Goals

### 2.1 Product goals

1. Add a **Connectors** item to the app sidebar.
2. When selected, show a connectors page with connector cards.
3. Let users connect, disconnect, and inspect connection status for supported connectors.
4. Expose connected-app capabilities as **agent tools** so the assistant can use them during chats.
5. Keep OAuth and provider credentials outside the renderer process.

### 2.2 Engineering goals

1. Introduce a provider-neutral connector abstraction in the controller.
2. Support one concrete provider first, while keeping room for Composio or Pipedream.
3. Reuse the existing tool registry and approval flow instead of adding a separate execution path.
4. Persist connector status and minimal audit metadata locally; cache provider tool metadata only when needed.
5. Preserve the current desktop-local security model.

### 2.3 Non-goals for the first connector release

1. Do not build a public marketplace.
2. Do not support user-authored custom connector code.
3. Do not store third-party OAuth refresh tokens directly in SQLite unless unavoidable.
4. Do not expose arbitrary provider actions without review, naming, descriptions, and approval policy.
5. Do not add background triggers or workflow automations in the first pass; start with agent-invoked tools.
6. Do not build full Composio + Pipedream runtime support in v1; implement one concrete provider first.
7. Do not build settings UI for provider developer credentials unless BYOK becomes an explicit product requirement.
8. Do not add per-chat connector scoping in v1; connected tools are globally available to the local install/user.

## 3. Recommended Provider Strategy

### 3.1 Preferred first implementation: Composio

Composio is the simpler first provider for this product shape because its model is already tool-first:

- The app can map the local profile/session to a stable `user_id`.
- Composio manages connected accounts and token refresh.
- `session.tools()` and lower-level tool execution APIs match the desired “connector as agent tools” path.
- Less provider-specific plumbing is needed to get useful GitHub / Notion / Google Drive tools into the agent loop.

Composio should be the only concrete provider implemented in v1 unless implementation starts proving that it cannot satisfy the required GitHub / Notion / Google Drive flows.

### 3.2 Keep Pipedream as a compatible second provider

Pipedream remains a strong fit if the product later needs:

- broader app/action discovery
- custom actions/components
- workflow invocation
- event triggers and automations
- environment-scoped project control

The internal abstraction should therefore avoid hard-coding Composio names into app-level APIs.

Do not implement a full Pipedream adapter in v1 unless the product explicitly prioritizes workflow invocation, triggers, or custom Pipedream components. Keep the provider abstraction thin and limited to the current connector-card and agent-tool needs.

### 3.3 Provider-neutral domain language

Use app-owned names in code and APIs:

- **Connector**: an external app integration such as GitHub or Notion.
- **Connection**: the current user's authenticated account for a connector.
- **Connector tool**: a curated action made available to the agent.
- **Connector provider**: Composio, Pipedream, or another managed integration backend.

Provider-specific mappings:

| App concept | Composio | Pipedream |
| --- | --- | --- |
| Connector | toolkit / app | app |
| Connection | connected account | connected account |
| Connector tool | tool / action | component action / MCP tool |
| User key | `user_id` | `external_user_id` |

### 3.4 V1 provider credential model

V1 supports provider API keys through controller-side environment/config only. Provider secrets are never exposed to the web UI or renderer process.

This means v1 is suitable for local development, dogfooding, and controlled distribution where the user/operator configures the provider key locally. A production shared-key model would require a hosted proxy so the desktop app never ships with an extractable shared provider credential; that hosted proxy is out of scope for this spec.

Settings UI for provider credentials is also out of scope for v1 unless the product explicitly chooses a BYOK model.

### 3.5 Stable local identity

Generate a `monet_install_id` UUID on first launch and persist it locally. Use this opaque ID as the provider user identity:

- Composio: `user_id`
- Pipedream, if added later: `external_user_id`

The ID must not be derived from email, username, host name, machine name, or any other personally identifying value. Resetting or deleting it requires revoking/deleting existing connector connections because provider-side connected accounts are keyed to this identity.

## 4. Target UX

### 4.1 Sidebar

Add a persistent sidebar item:

```text
Recent
Connectors
Settings
```

Clicking **Connectors** navigates to `/connectors`.

Implementation areas:

- `apps/web-ui/src/components/app-shell.tsx`
- `apps/web-ui/src/main.tsx`

### 4.2 Connectors page

Create a route-level page using the existing app shell and page frame patterns.

Suggested page sections:

1. Header
   - Title: `Connectors`
   - Subtitle: `Connect apps so the agent can read, search, and act with your approval.`
2. Filters / search
   - Search by connector name.
   - Optional category chips: `All`, `Connected`, `Productivity`, `Developer`, `Storage`.
3. Connector cards grid
   - Logo / icon
   - Name
   - Short capability summary
   - Connection status
   - Primary action: `Connect`, `Manage`, or `Reconnect`
   - Secondary action: `View tools`
4. Connector detail drawer
   - Status and connected account label
   - Available tools
   - Approval requirements
   - Disconnect action

Initial connector cards:

| Connector | Category | Example agent capabilities |
| --- | --- | --- |
| GitHub | Developer | Search repositories, inspect issues/PRs, create issues, comment on PRs |
| Notion | Productivity | Search pages/databases, read pages, create or update pages |
| Google Drive | Storage | Search files, read docs/sheets metadata, retrieve file contents where supported |

### 4.3 Empty and setup states

- If no provider API key is configured, show setup guidance and link to settings.
- If a connector is unavailable from the chosen provider, show it disabled with explanatory copy.
- If a connection is expired or revoked, show `Reconnect`.
- The `Connectors` nav item lives in the main sidebar navigation, not only inside Settings.
- The nav item is active for `/connectors` and connector detail drawer states.
- Filters and category chips are optional in v1. If only GitHub, Notion, and Google Drive are available, ship a simple card grid first.

### 4.4 Feature flag

Ship connectors behind a `features.connectors` flag.

When disabled:

- Hide the sidebar item.
- Return 404 from connector routes.
- Do not mount the connector tool source.
- Do not include connector tools in chat runtime tool composition.

## 5. Target Architecture

```text
┌─────────────────────────────────────────────┐
│ Web UI                                      │
│ - Sidebar Connectors item                   │
│ - /connectors card list                     │
│ - Connect/manage flows                      │
└───────────────────┬─────────────────────────┘
                    │ Local HTTP
┌───────────────────▼─────────────────────────┐
│ Hono Controller                             │
│ - Connector routes                          │
│ - Connector provider adapter                │
│ - Tool registry bridge                      │
│ - Approval policy                           │
└───────────────────┬─────────────────────────┘
                    │ Provider SDK/API
┌───────────────────▼─────────────────────────┐
│ Composio or Pipedream                       │
│ - OAuth connection flow                     │
│ - Token storage/refresh                     │
│ - Tool/action discovery                     │
│ - Tool/action execution                     │
└─────────────────────────────────────────────┘
```

## 6. Backend Design

### 6.1 New modules

Add controller modules similar to:

```text
apps/controller/src/connectors/
  catalog.ts
  provider.ts
  composio-provider.ts
  pipedream-provider.ts        # optional later
  service.ts
  tool-adapter.ts

apps/controller/src/routes/connectors.ts
```

### 6.2 Connector provider interface

Define an internal interface that hides Composio/Pipedream differences:

```ts
export interface ConnectorProvider {
  listConnectors(): Promise<ConnectorCatalogItem[]>;
  getConnectionStatus(input: {
    userId: string;
    connectorId: string;
    abortSignal?: AbortSignal;
  }): Promise<ConnectorConnectionStatus>;
  createConnection(input: {
    userId: string;
    connectorId: string;
    redirectUrl?: string;
    state: string;
    abortSignal?: AbortSignal;
  }): Promise<ConnectorConnectionStart>;
  disconnect(input: {
    userId: string;
    connectorId: string;
    abortSignal?: AbortSignal;
  }): Promise<void>;
  listTools(input: {
    userId: string;
    connectorId?: string;
    abortSignal?: AbortSignal;
  }): Promise<ConnectorToolDefinition[]>;
  executeTool(input: {
    userId: string;
    toolId: string;
    args: unknown;
    connectionId?: string;
    abortSignal: AbortSignal;
  }): Promise<ConnectorToolResult>;
}
```

Network-bound provider calls should accept an `AbortSignal` where possible. Chat-run cancellation must abort in-flight connector tool execution when the provider SDK/API supports it.

### 6.3 Connector catalog

Keep a local curated catalog even if the provider supports broad discovery. This prevents accidentally exposing hundreds of tools/actions to the agent.

Each item should include:

- `id`: stable app ID, e.g. `github`, `notion`, `google_drive`
- `providerConnectorId`: provider-specific toolkit/app key
- `displayName`
- `description`
- `category`
- `icon`
- `featuredTools`
- `enabledByDefault`
- `minimumApprovalPolicy`

Each connector must also define a curated v1 allowlist of approximately 5–10 provider tools. Prefer read-only tools first. Do not expose the provider's entire tool/action catalog to the agent.

### 6.4 Dynamic tool source integration

Integrate connector tools through the existing controller tool path:

- `apps/controller/src/tools/registry.ts`
- `apps/controller/src/tools/builtins.ts`
- `apps/controller/src/routes/tools.ts`
- `apps/controller/src/routes/chat.ts`

Implementation approach:

1. Extend the tool system with a dynamic `ToolSource` concept.
2. Keep built-in tools as a static source.
3. Add a `ConnectorToolSource` that resolves currently connected, curated tools for the active `monet_install_id` at chat runtime.
4. Compose built-in tools and connector tools for each chat run instead of only registering connector tools at controller startup.
5. Convert each connector tool into the existing internal tool definition shape.
6. Prefix tool names to avoid collisions, e.g.:
   - `github_search_repositories`
   - `github_create_issue`
   - `notion_search_pages`
   - `google_drive_search_files`
7. Detect collisions after prefixing and fail closed if a connector tool conflicts with an existing tool.
8. Route execution through `ConnectorProvider.executeTool(...)`.
9. Preserve existing approval and tool-call persistence behavior.

Connector tools are dynamic and user-specific: they appear after OAuth, disappear after disconnect, and may need provider metadata refresh. Do not assume startup-time registration is sufficient.

### 6.5 Schema mapping

Provider tool definitions are expected to expose JSON Schema or JSON-Schema-like input schemas. Connector tools should wrap provider JSON Schemas using the AI SDK `jsonSchema()` helper or an equivalent JSON Schema-compatible API.

Do not build a runtime JSON-Schema-to-Zod converter in v1. Built-in tools may continue using their existing schema definitions. Schema validation errors should be normalized as `invalid_arguments`.

### 6.6 Approval policy

Default policy should be conservative:

- Read-only tools may be auto-approved only if existing app policy allows it.
- Write, delete, send, invite, comment, share, or permission-changing tools must require approval.
- The approval UI should show:
  - connector name
  - target account, if available
  - action/tool name
  - summarized arguments
  - provider execution ID after completion, if available

Connector tools should use structured policy metadata instead of a single boolean:

```ts
type ConnectorToolPolicy = {
  sideEffect: 'read' | 'write' | 'destructive' | 'external_send';
  approval: 'never' | 'first_use' | 'always';
};
```

V1 defaults:

| Side effect | Default approval |
| --- | --- |
| `read` | `first_use` |
| `write` | `always` |
| `destructive` | `always` |
| `external_send` | `always` |

### 6.7 Error taxonomy

Provider-specific errors must be normalized before returning tool results or API responses. Use these v1 error codes:

- `connection_missing`
- `connection_expired`
- `rate_limited`
- `upstream_unavailable`
- `invalid_arguments`
- `forbidden`
- `tool_not_found`
- `provider_error`

Revoked or expired credentials should update connection status and surface a reconnect action to the user.

### 6.8 Disconnect semantics

Disconnecting a connector must:

1. Revoke the provider connection when supported.
2. Mark local connection metadata as disconnected.
3. Invalidate connector tool availability for future chat runs.
4. Cancel pending tool approvals associated with that connector using reason `connector_disconnected`.
5. Prevent an already-approved but not-yet-executed connector tool call from executing after disconnect.

## 7. API Design

Add connector routes under `/api/connectors`.

### 7.1 List connector cards

```http
GET /api/connectors
```

Returns local catalog merged with provider connection status.

```ts
type ConnectorListResponse = {
  connectors: Array<{
    id: string;
    displayName: string;
    description: string;
    category: string;
    icon?: string;
    status: 'not_connected' | 'connected' | 'expired' | 'unavailable';
    connectedAccountLabel?: string;
    featuredTools: string[];
  }>;
};
```

### 7.2 Start connection flow

```http
POST /api/connectors/:connectorId/connect
```

Returns a provider authorization URL or a completed status for non-OAuth connectors.

```ts
type ConnectorConnectResponse = {
  status: 'redirect_required' | 'connected' | 'pending';
  redirectUrl?: string;
};
```

### 7.3 OAuth callback

Completes or verifies provider OAuth flow, then redirects or navigates back to `/connectors`.

OAuth callbacks must not rely on authenticated `/api/*` browser requests because a provider redirect will not include the app's local bearer token. For desktop, the preferred v1 callback is a registered custom protocol URL:

```text
monet://connectors/callback
```

The Electron main process should receive the custom protocol URL and forward the callback data to the local controller over the authenticated local channel.

If a local HTTP callback is used instead, it must be outside the normal authenticated `/api/*` surface or explicitly exempted from bearer auth, and it must be protected by strict OAuth `state` validation.

Callback security requirements:

1. Generate a cryptographically random `state` on connect start.
2. Store only a hashed or opaque state record locally.
3. Bind state to connector ID, provider, `monet_install_id`, and a short TTL.
4. Reject expired, unknown, connector-mismatched, or already-used state.
5. Delete or mark state as consumed after first successful callback.
6. Never log OAuth codes, state secrets, tokens, or provider authorization headers.
7. On callback failure, redirect back to `/connectors` with a generic error state and store detailed safe error metadata locally.

### 7.4 Connector detail

```http
GET /api/connectors/:connectorId
```

Returns connector details, status, and available curated tools.

### 7.5 Disconnect

```http
DELETE /api/connectors/:connectorId/connection
```

Disconnects or revokes the provider-managed account where supported.

### 7.6 `/api/tools` behavior

The actual agent-visible tool set is contextual because connector tools depend on current connection state. V1 should keep `/api/tools` focused on built-in/static tool metadata unless the UI explicitly needs to display runtime connector tools there.

For chat execution, compose the runtime tool set inside the chat route from:

1. built-in static tools
2. dynamic connector tools from `ConnectorToolSource`

If the UI later needs to inspect the exact runtime tool set, add a dedicated endpoint such as:

```http
GET /api/runtime-tools
```

Do not make `/api/tools` ambiguous without documenting whether it is static metadata or the current runtime tool set.

## 8. Persistence

Prefer provider-managed OAuth token storage. Local SQLite should store only app metadata needed for UI and audit.

Suggested new tables:

### 8.1 `connector_connections`

```sql
CREATE TABLE connector_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_connection_id TEXT,
  account_label TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_connected_at TEXT,
  last_error TEXT
);
```

### 8.2 `connector_oauth_states`

```sql
CREATE TABLE connector_oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  redirect_url TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
```

The plaintext state value must not be logged. Prefer storing a hash of the state rather than the state itself.

### 8.3 `connector_tool_cache`

Persistent tool caching is optional in v1. Prefer a code-defined curated allowlist plus an in-memory provider metadata cache with TTL unless measured latency requires persistence.

If persistent caching is used, include explicit refresh and invalidation metadata:

```sql
CREATE TABLE connector_tool_cache (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_tool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT NOT NULL,
  approval_policy TEXT NOT NULL,
  schema_version TEXT,
  last_refreshed_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);
```

Notes:

- If the current app does not yet model multiple local users, use a stable local installation/user ID internally and add `user_id` columns later when the app supports profiles.
- Do not store access tokens or refresh tokens in these tables.
- Tool execution history should continue to use the existing tool-call persistence path, with connector metadata included in tool-call details.

For v1, `user_id` should be the locally persisted `monet_install_id`.

## 9. Frontend Implementation Plan

### 9.1 Routing and navigation

1. Add `/connectors` route in `apps/web-ui/src/main.tsx`.
2. Add a `Connectors` sidebar item in `apps/web-ui/src/components/app-shell.tsx`.
3. Ensure active state works for `/connectors` and connector detail drawer states.

### 9.2 Page components

Create:

```text
apps/web-ui/src/app/connectors/
  page.tsx
  connector-card.tsx
  connector-detail-drawer.tsx
  connector-status-badge.tsx
```

If the app prefers flat component folders, keep route-only components colocated with the page and extract shared UI later.

### 9.3 Data access

Add a small client module:

```text
apps/web-ui/src/lib/connectors-api.ts
```

Functions:

- `listConnectors()`
- `getConnector(id)`
- `startConnectorConnection(id)`
- `disconnectConnector(id)`

### 9.4 Interaction behavior

- `Connect` calls `POST /api/connectors/:id/connect`.
- If `redirect_required`, open the provider URL in the system browser or an Electron-safe external flow.
- On return, reload connector status.
- `View tools` opens a drawer.
- `Disconnect` requires confirmation.

## 10. Backend Implementation Plan

### Phase 1: Connector catalog and UI shell

1. Add static connector catalog for GitHub, Notion, and Google Drive.
2. Add `/api/connectors` returning catalog items with `not_connected` status.
3. Add sidebar item and `/connectors` page rendering cards.
4. Add loading, error, empty, and unavailable states.

### Phase 2: Provider adapter

1. Add `ConnectorProvider` interface.
2. Add `ComposioConnectorProvider` as the first adapter.
3. Add controller-side provider configuration through environment/local config only.
4. Generate and persist `monet_install_id`.
5. Implement connection start with single-use OAuth state.
6. Implement custom protocol or otherwise auth-safe callback verification.
7. Persist connection metadata locally.

### Phase 3: Tool discovery and curation

1. Fetch provider tools for connected catalog items.
2. Map provider schemas into internal tool definitions.
3. Filter tools against a curated allowlist per connector.
4. Wrap provider JSON Schemas using JSON Schema-compatible AI SDK tooling.
5. Cache tool metadata in memory with TTL; add persistent cache only if needed.
6. Decide whether connector tool details need a dedicated runtime-tools endpoint.

### Phase 4: Agent execution

1. Add dynamic `ConnectorToolSource` runtime composition.
2. Prefix tool names by connector and detect collisions.
3. Execute via the provider adapter with `AbortSignal` support.
4. Persist connector execution metadata in tool-call records.
5. Verify approval behavior for read, write, destructive, and external-send tools.
6. Verify disconnect cancels pending approvals and prevents late execution.

### Phase 5: Hardening

1. Add retry and error normalization around provider calls.
2. Handle expired/revoked connections.
3. Add rate-limit messaging.
4. Add audit-friendly logging without secrets.
5. Add tests and manual QA scenarios.

## 11. Security and Privacy Requirements

1. Provider API keys and OAuth secrets must remain in the controller/main process environment, never the renderer.
2. Do not expose provider refresh tokens to the UI.
3. Do not log OAuth codes, access tokens, refresh tokens, provider API keys, or raw authorization headers.
4. Tool arguments should be redacted where they may contain secrets or personal data.
5. All write-capable tools require explicit user approval by default.
6. Connector disconnect should revoke provider-managed credentials when the provider supports it.
7. Use a stable local user identifier when calling provider APIs (`user_id` / `external_user_id`) rather than email addresses.
8. Provider secrets should be configured only through controller-side environment/local config in v1.
9. OAuth callbacks must validate single-use, short-lived state before completing connection.
10. Logs may include connector ID, tool name, duration, status, and normalized error code.
11. Logs must not include OAuth codes, access tokens, refresh tokens, provider API keys, raw arguments, or raw tool results.

## 12. Testing and QA

### 12.1 Backend tests

- Connector catalog returns expected GitHub / Notion / Google Drive items.
- Provider adapter maps connection statuses correctly.
- Tool-name prefixing prevents collisions.
- Disallowed provider tools are filtered out.
- Write tools require approval.
- Provider errors are normalized for UI and logs.
- `monet_install_id` is generated once and reused.
- OAuth state is single-use, short-lived, and bound to connector/provider/user.
- Runtime tool composition includes connected allowlisted connector tools only.
- Aborting a chat run aborts in-flight connector tool execution where supported.
- Disconnect cancels pending connector approvals and removes tools from future runs.

### 12.2 Frontend tests

- Sidebar renders `Connectors` and navigates to `/connectors`.
- Connector cards render all expected fields.
- Status badges render connected, not connected, expired, and unavailable states.
- Connect flow handles redirect and pending states.
- Disconnect flow requires confirmation.
- Feature flag hides sidebar and route surface when disabled.

### 12.3 Manual QA

1. Open app and verify sidebar contains `Connectors`.
2. Click `Connectors` and verify connector cards display.
3. Connect GitHub through provider OAuth.
4. Start a chat and ask the agent to perform a read-only GitHub action.
5. Ask the agent to perform a write action, such as creating an issue, and verify approval is required.
6. Revoke the app from the external provider and verify the UI shows reconnect/expired state.
7. Disconnect the connector and verify its tools are no longer available to the agent.
8. Abort a chat run during connector tool execution and verify cancellation behavior.
9. Trigger a revoked/expired provider connection and verify reconnect state.

## 13. Open Questions

1. Should the product eventually support BYOK in Settings, or should production use a hosted proxy?
2. When should Pipedream be implemented: only when workflows/triggers are required, or as a near-term alternative provider?
3. Which exact 5–10 allowlisted tools should ship for GitHub, Notion, and Google Drive?
4. Should read-only connector tools remain `first_use` approval forever, or become configurable later?
5. Should MCP be considered later as a connector/tool transport after the direct provider adapter path is stable?

## 14. Explicit YAGNI Guardrails

Avoid expanding v1 into a general integration platform. Specifically:

1. Do not implement both Composio and Pipedream unless the first provider cannot satisfy the required connectors.
2. Do not persist extensive provider tool metadata unless in-memory caching causes measurable UX or runtime issues.
3. Do not build a provider credential Settings UI unless BYOK is selected as a product requirement.
4. Do not expose whole provider tool catalogs.
5. Do not introduce workflow, trigger, schedule, or background automation concepts in v1.
6. Do not introduce per-chat connector scoping unless global connected tools create a concrete product or safety issue.
7. Do not adopt MCP in v1; treat it as future connector/tool transport research.

## 15. Acceptance Criteria

1. Sidebar includes `Connectors` and routes to `/connectors`.
2. `/connectors` shows connector cards for GitHub, Notion, and Google Drive.
3. Users can initiate provider-backed connection flow for supported connectors.
4. OAuth callback validates single-use state before completing connection.
5. A stable `monet_install_id` is generated and reused as provider user identity.
6. Connected connector tools appear in the agent's runtime tool set.
7. Only curated allowlisted tools are exposed to the agent.
8. Connector tool execution uses the existing approval and persistence path.
9. Write, destructive, and external-send connector tools require approval.
10. Disconnecting a connector removes its tools from future runs.
11. Disconnecting a connector cancels pending approvals for that connector.
12. Revoked or expired provider credentials mark the connection as expired and prompt reconnect.
13. Aborting a chat run aborts in-flight connector tool execution where supported.
14. No OAuth tokens or provider secrets are exposed to the renderer or logs.
15. Logs do not include OAuth codes, access tokens, refresh tokens, API keys, or raw sensitive payloads.
