# Live Artifacts Implementation Plan

Source product spec: https://powerformer.feishu.cn/wiki/YfW5wvkRai5eCIkhNDlcdgXqnPd

## 1. Background

Live Artifacts turns one-off chat output into persistent, refreshable pages powered by connector data. The product spec frames them as Agent-built personal dashboards: the user describes what they want, the agent asks clarifying questions, uses connected apps to inspect live data, then creates a page that can be reopened and manually refreshed.

This repository already has most of the foundations needed for a v0.1 implementation:

- **Chat runtime and tool approvals** in `apps/controller/src/routes/chat.ts`, `apps/controller/src/routes/runs.ts`, and `apps/web-ui/src/components/chat-thread.tsx`.
- **Connector groundwork** in `apps/controller/src/connectors/*`, connector migrations, settings, and `/connectors` UI.
- **Session workspaces** in `apps/controller/src/session-workspace-service.ts`, useful for generated supporting files and previews.
- **SQLite persistence** in `apps/controller/src/chat-storage.ts`, with migration support in `packages/database/migrations/`.

## 2. Product Goals

1. Add a first-class **Live Artifacts** surface in the sidebar.
2. Let users create an artifact conversationally from chat, preferably after connector setup.
3. Persist artifacts as local records linked to the creating session.
4. Render each artifact as a dedicated page/pane, not only as a chat attachment.
5. Let users manually refresh artifact tiles by re-running their bound connector/tool calls.
6. Preserve the existing local-first security model: no third-party credentials in the renderer, and live connector actions remain observable and approval-aware.

## 3. V0.1 Scope

### Prerequisites and phase gate

Refreshable connector-backed Live Artifacts depend on the connector runtime being complete enough to:

1. List connected accounts and expose stable account labels.
2. Expose curated read-only connector tools with stable provider tool IDs.
3. Execute connector tools through `ConnectorProvider.executeTool` or an equivalent audited controller-side execution path.
4. Normalize missing, expired, revoked, or unavailable connection errors.
5. Persist connector tool-call metadata without exposing credentials to the renderer.

If this connector maturity is not available when Live Artifacts work begins, ship the first increment as **static persisted artifacts created from chat** and defer connector-backed refresh until the connector runtime satisfies the above contract.

Implementation check (2026-04-28): the existing connector runtime has stable curated provider tool IDs, read-only v1 catalog policies, persisted connector tool-call metadata, and normalized missing/expired provider errors. Stable connected account labels remain only partially guaranteed because Composio labels can fall back to mutable provider profile fields such as email or name, and refresh-specific audit records have not yet been chosen or implemented. Therefore the first Live Artifacts increment is scoped to static persisted artifact creation/list/detail/update surfaces; connector-backed refresh APIs, UI, and tests stay behind the refresh phase gate until stable account labeling and refresh audit persistence are complete.

### Default approval mode

Use this MVP-wide default approval mode:

```text
auto-approve read-only
confirm writes/unknown
```

Rules:

1. Clearly read-only tools may execute without an approval prompt.
2. Write-capable, destructive, side-effecting, or externally visible tools require confirmation.
3. Unknown or unclassified tools require confirmation.
4. Connector tools must be classified through the curated connector catalog before they can be treated as read-only.
5. Live Artifact manual refresh may skip repeat confirmation only when every tile source being refreshed is still classified as read-only.

For Composio-backed connector tools, classification should use Composio tool metadata when available:

1. Treat tools tagged with `readOnlyHint` as eligible for read-only auto-approval.
2. Treat tools tagged with `destructiveHint` as confirmation-required.
3. Treat missing, unknown, or ambiguous tags as confirmation-required.
4. Treat `idempotentHint` only as a retry-safety hint, not as proof that the tool is read-only.
5. Use OAuth scopes as a secondary backstop: scopes containing write-like capabilities such as `write`, `create`, `update`, `delete`, `admin`, `send`, `post`, or `manage` force confirmation even if other metadata is unclear.

Do not rely on a single Composio `read_only` field; current Composio metadata is tag/scope-driven rather than a dedicated safety enum.

### In scope

1. Sidebar entry: **Live Artifacts**.
2. `/artifacts` index page showing saved artifacts.
3. `/artifacts/:artifactId` detail page with rendered tiles and manual refresh.
4. Agent tools for creating/updating artifacts from chat:
   - `create_live_artifact`
   - `update_live_artifact`
   - `list_live_artifacts`
5. Artifact storage in SQLite.
6. Tile source bindings to existing tools/connector tools.
7. Manual refresh only.
8. Basic export/download path can be deferred unless cheap; the UI should reserve an action slot for it.

### Out of scope for v0.1

1. Background scheduled refresh.
2. Public template marketplace.
3. Fully visual dashboard builder or drag/drop tile editing.
4. Sharing/collaboration.
5. Multi-user permission model.
6. Automatically approving connector writes, side effects, or unknown/unclassified actions.
7. Arbitrary user-authored JavaScript inside artifacts.
8. Server-side hosted proxy for shared connector credentials.

## 4. Core Product Model

### 4.1 Definitions

- **Live Artifact**: a persisted dashboard/page generated by the agent.
- **Tile**: an artifact section backed by either static content or a refreshable data source.
- **Tile source**: the stored recipe for refreshing a tile, including tool name, connector metadata, redacted input arguments, and refresh permission.
- **Render document**: the safe JSON/Markdown model the UI renders. Do not persist or execute arbitrary HTML/JS.

### 4.2 Recommended v0.1 artifact shape

```ts
interface LiveArtifact {
  id: string;
  schemaVersion: 1;
  sessionId: string | null;
  createdByRunId: string | null;
  createdByToolCallId: string | null;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  pinned: boolean;
  refreshStatus: "idle" | "refreshing" | "failed";
  refreshStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  lastRefreshError: string | null;
}

interface LiveArtifactTile {
  id: string;
  artifactId: string;
  position: number;
  title: string;
  kind: "markdown" | "metric" | "list" | "table" | "link_card" | "json";
  renderJson: LiveArtifactRenderJson;
  sourceJson: LiveArtifactTileSource | null;
  refreshStatus: "idle" | "refreshing" | "failed";
  refreshStartedAt: string | null;
  lastRefreshedAt: string | null;
  lastError: string | null;
}

interface LiveArtifactTileSource {
  type: "tool" | "connector_tool";
  toolName: string;
  input: Record<string, unknown>;
  connector?: {
    connectorId: string;
    connectorName: string;
    accountLabel: string | null;
    providerToolId: string | null;
  };
  refreshPermission: "manual_refresh_granted_for_read_only" | "requires_confirmation";
  outputMapping: {
    preferredKind?: LiveArtifactTile["kind"];
  };
}
```

`sourceJson.input` must be a validated, redacted, minimal allowlist of arguments required to repeat a read-only query. Do not store credentials, bearer tokens, raw provider responses, or broad personal data when a stable resource ID/filter is sufficient.

### 4.3 Render JSON schemas

`renderJson` is a persistent UI boundary and must not be `unknown` in implementation. Define zod schemas for each tile kind in `apps/controller/src/live-artifacts/schema.ts` and reuse equivalent TypeScript types in the web UI.

Recommended v0.1 shapes:

```ts
type LiveArtifactRenderJson =
  | { kind: "markdown"; markdown: string }
  | { kind: "metric"; label: string; value: string; caption?: string; trend?: "up" | "down" | "flat" }
  | { kind: "list"; items: Array<{ title: string; subtitle?: string; url?: string }> }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "link_card"; title: string; url: string; description?: string; sourceLabel?: string }
  | { kind: "json"; value: unknown };
```

Validation requirements:

1. Enforce max lengths for titles, labels, markdown, table cells, URLs, and errors.
2. Enforce max rows/items per tile to avoid renderer and SQLite bloat.
3. Allow only `http:` and `https:` URLs.
4. Strip or reject raw HTML/script content from markdown and connector-derived text.
5. Preserve previous valid `renderJson` when refresh output fails validation.

## 5. UX Requirements

### 5.1 Sidebar

Update `apps/web-ui/src/components/app-shell.tsx`:

```text
Recent

Live Artifacts
Connectors
Settings
```

The item is active for `/artifacts` and `/artifacts/:artifactId`.

### 5.2 Artifacts index page

Add `apps/web-ui/src/app/artifacts/page.tsx` and route wiring in `apps/web-ui/src/main.tsx`.

Sections:

1. Header
   - Title: `Live Artifacts`
   - Subtitle: `Create dynamic artifacts that stay up-to-date using live data from your connectors.`
2. Primary actions
   - `New artifact` starts a new chat with a seeded prompt.
   - `Browse connectors` links to `/connectors`.
3. Artifact list/grid
   - Title, description, pinned state, source connector badges, last refreshed time.
   - Empty state explains that artifacts are created from chat.

### 5.3 Chat creation flow

The source product spec emphasizes “conversation + structured choice cards.” For v0.1, implement this through agent instructions and simple tool calls first; dedicated structured choice UI can follow.

Recommended seeded prompt for `New artifact`:

```text
I want to make a live artifact. Explain what live artifacts are, look at my connected apps, and ask me questions to figure out what would be useful.
```

Agent behavior requirements:

1. Explain what Live Artifacts are in one short paragraph.
2. Inspect available connectors/tools.
3. Ask clarifying questions about:
   - connector/data source
   - artifact pattern, such as morning check-in, status tracker, recurring report, investigation dashboard
   - usage frequency
   - concrete resource anchors, such as URLs, repo names, issue filters, or document IDs
4. Surface connector limitations honestly.
5. Before creating the artifact, call `create_live_artifact`; this tool should require user confirmation because it persists a new live page and grants future refresh permission for included read-only sources.

### 5.4 Artifact detail page

Add a dedicated detail view with:

1. Header: title, source connector badges, `Last refreshed` timestamp.
2. Actions:
   - `Refresh`
   - `Pin` / `Pinned`
   - `Open creating chat`
   - reserved `Download as PDF` slot for later
3. Tile layout:
   - Simple responsive one-column/two-column grid.
   - Render only whitelisted tile kinds.
   - Show per-tile loading/error states.
4. Provenance:
   - Show source connector/tool name per tile.
   - Include source links where available.

## 6. Backend Design

### 6.1 New modules

```text
apps/controller/src/live-artifacts/
  schema.ts
  service.ts
  render.ts
  refresh.ts
  tools.ts

apps/controller/src/routes/live-artifacts.ts
```

Responsibilities:

- `schema.ts`: zod schemas and domain types.
- `service.ts`: CRUD operations backed by `ChatStorage` or a narrow artifact storage wrapper.
- `render.ts`: sanitize/normalize agent-provided render JSON.
- `refresh.ts`: re-run stored tile sources and update tile render JSON.
- `tools.ts`: register agent-facing artifact tools with the existing `ToolRegistry`.
- `routes/live-artifacts.ts`: REST API for UI list/detail/refresh/pin/archive.

### 6.2 API routes

Add routes similar to:

```text
GET    /api/live-artifacts
POST   /api/live-artifacts
GET    /api/live-artifacts/:artifactId
PATCH  /api/live-artifacts/:artifactId
POST   /api/live-artifacts/:artifactId/refresh
POST   /api/live-artifacts/:artifactId/tiles/:tileId/refresh
POST   /api/live-artifacts/:artifactId/archive
```

Route rules:

- Validate all IDs and payloads with zod.
- Do not expose connector secrets or raw provider credentials.
- Refresh is explicit and user-triggered in v0.1.
- Start with whole-artifact refresh; per-tile refresh can be added if low-cost.
- Register the route module from `apps/controller/src/app.ts` using the same local auth and error conventions as existing `/api/*` routes.
- Add OpenAPI tags/schemas if the route follows the current OpenAPI route style, then regenerate web client types if applicable.

### 6.3 Database migrations

Add `packages/database/migrations/0008_live_artifacts.sql` and journal metadata.

Suggested tables:

```sql
CREATE TABLE live_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_by_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  created_by_tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  refresh_status TEXT NOT NULL DEFAULT 'idle' CHECK (refresh_status IN ('idle', 'refreshing', 'failed')),
  refresh_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_refreshed_at TEXT,
  last_refresh_error TEXT,
  UNIQUE(slug)
);

CREATE INDEX live_artifacts_status_updated_idx
  ON live_artifacts(status, updated_at);

CREATE TABLE live_artifact_tiles (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES live_artifacts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('markdown', 'metric', 'list', 'table', 'link_card', 'json')),
  render_json TEXT NOT NULL,
  source_json TEXT,
  refresh_status TEXT NOT NULL DEFAULT 'idle' CHECK (refresh_status IN ('idle', 'refreshing', 'failed')),
  refresh_started_at TEXT,
  last_refreshed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX live_artifact_tiles_artifact_position_idx
  ON live_artifact_tiles(artifact_id, position);
```

Storage constraints that must be enforced in application code because SQLite cannot express them cleanly:

1. Bound `title`, `description`, `render_json`, `source_json`, `last_error`, and `last_refresh_error` sizes.
2. Validate JSON against the render/source schemas before insert/update.
3. Preserve a previous valid tile render if a refresh result is oversized or invalid.
4. Keep archive reversible unless a future hard-delete route is added; archived artifacts are hidden from default lists.

### 6.4 Agent tools

Register tools in the same runtime path that currently composes file and connector tools.

#### `create_live_artifact`

Inputs:

- `title`
- `description`
- `tiles[]`
- optional `sessionId`

Behavior:

- Requires confirmation.
- Artifact creation confirmation grants future manual refresh only for included sources that are explicitly classified as read-only and stored with `refreshPermission: "manual_refresh_granted_for_read_only"`.
- Sanitizes tile render JSON.
- Persists artifact and tiles.
- Persists `createdByRunId` and `createdByToolCallId` when created from chat.
- Returns artifact ID and URL.

#### `update_live_artifact`

Inputs:

- `artifactId`
- patch for title/description/tiles

Behavior:

- Requires confirmation when changing tile sources or adding refresh permissions.
- Allows safe title/description edits with low friction.

#### `list_live_artifacts`

Read-only, no confirmation.

### 6.5 Refresh engine

Manual refresh must not execute through an untracked hidden path. Engineering must choose and implement one audited execution model before invoking connector tools:

1. **Preferred:** create a refresh-scoped run/tool-call audit record and execute through the existing tool/connector runtime where practical.
2. **Acceptable fallback:** add equivalent artifact-refresh audit records before invoking connector provider tools directly.

Do not call connector provider APIs directly from refresh without persisted audit metadata.

Algorithm:

1. Load artifact and tiles.
2. Reject or no-op if the artifact or target tile is already `refreshing`; v0.1 should prevent overlapping refreshes for the same artifact.
3. For each tile with `sourceJson`:
   - Validate the source against the current connector/tool catalog.
   - Check `refreshPermission`.
   - Re-run only sources classified as read-only and granted during artifact creation/update.
   - Transform output into the tile render kind through a deterministic mapper.
   - Validate the mapped render JSON.
4. Persist refreshed tile render JSON and timestamps.
5. If one tile fails, preserve its previous render JSON, set tile-level `lastError`, and continue refreshing other eligible tiles.
6. Return the updated artifact plus any partial failures.

Important constraints:

1. v0.1 must not silently execute write-capable connector actions during refresh.
2. If a source is write-capable, side-effecting, unknown, or no longer classified as read-only, return `requires_confirmation` and ask the user to refresh from chat or reconfigure the tile as read-only.
3. If read-only classification is unavailable, treat the source as confirmation-required.
4. v0.1 refresh mapping must be deterministic. Do not require an LLM/provider call to refresh an artifact; LLM summarization can be a later enhancement.

## 7. Frontend Design

### 7.1 Routes

Update `apps/web-ui/src/main.tsx`:

```tsx
<Route path="/artifacts" element={<ArtifactsPage />} />
<Route path="/artifacts/:artifactId" element={<ArtifactDetailPage />} />
```

### 7.2 Client API

Add a small client module:

```text
apps/web-ui/src/lib/live-artifacts-api.ts
```

Functions:

- `fetchLiveArtifacts()`
- `fetchLiveArtifact(id)`
- `refreshLiveArtifact(id)`
- `updateLiveArtifact(id, patch)`
- `archiveLiveArtifact(id)`

If OpenAPI generation is part of the normal flow, update generated types after controller route schemas are added.

### 7.3 Components

```text
apps/web-ui/src/components/live-artifacts/
  artifact-card.tsx
  artifact-detail.tsx
  artifact-tile.tsx
  artifact-source-badge.tsx
  artifact-empty-state.tsx
```

Keep tile rendering intentionally constrained:

- Markdown: render through the existing markdown/Streamdown path where safe.
- Metric/list/table/link card: render typed JSON.
- JSON: collapsed debug fallback for unsupported mappings.
- Derive source connector badges from tile `sourceJson` rather than duplicating artifact-level connector state.
- “Open creating chat” should navigate to `/` with the creating session selected. If the session has been deleted or archived, show an unavailable/archived state instead of failing silently.

## 8. Integration With Connectors

Live Artifacts should build on the connector abstraction from `specs/2026-04-27-external-connectors/spec.md`.

Implementation dependencies:

1. Connector settings must expose Composio API key readiness.
2. Connected accounts must have stable `connectorId`, account label, and provider tool IDs.
3. Connector tools must carry metadata into tool-call persistence; existing columns in migrations `0006` and `0007` are intended for this.
4. Artifact tile sources should reference connector metadata but never store OAuth tokens or provider API keys.

If connectors are not configured, `/artifacts` still renders but `New artifact` should guide users to `/connectors` or settings.

## 9. Security and Privacy Requirements

1. Never persist third-party OAuth tokens in artifact records.
2. Redact secrets from stored tile source inputs using the same patterns as `chat-storage.ts`.
3. Do not render raw HTML or arbitrary scripts from connector output.
4. Use the default approval mode `auto-approve read-only; confirm writes/unknown` globally.
5. Confirmation remains required for artifact creation, source-changing updates, and all write-capable connector tools or tools whose safety cannot be classified.
6. Manual refresh may skip repeat confirmation only for sources that were explicitly granted during artifact creation/update and are still classified as read-only at refresh time.
7. Keep all refresh execution in the controller process.
8. Treat artifact render JSON as untrusted data at the UI boundary.
9. Include source/provenance metadata so users can inspect why a tile shows certain data.

## 10. Implementation Phases

### Phase 1: Persistence and API skeleton

1. Add migrations for `live_artifacts` and `live_artifact_tiles`.
2. Add storage methods for create/list/get/update/archive.
3. Add route module and app registration.
4. Add controller tests for CRUD and validation.

### Phase 2: UI navigation and read-only artifact pages

1. Add sidebar nav item.
2. Add `/artifacts` and `/artifacts/:artifactId` routes.
3. Add typed client API.
4. Render static tiles from persisted `renderJson`.
5. Add empty/setup states.

### Phase 3: Agent creation tools

1. Register `create_live_artifact`, `update_live_artifact`, and `list_live_artifacts`.
2. Add confirmation for create/update.
3. Return artifact URLs in tool output so chat can link to the artifact.
4. Add tests for tool schema, approval behavior, and persisted output.

### Phase 4: Manual refresh

Phase 4 may begin only after connector read-only tool execution, connection expiration handling, and approval/audit behavior are verified. If that gate is not met, ship Phases 1–3 as static persisted artifacts and defer refresh.

1. Implement refresh service for read-only tool/connector sources.
2. Add `POST /api/live-artifacts/:id/refresh`.
3. Add UI refresh button with loading/error states.
4. Persist per-tile refresh timestamps and errors.
5. Add tests for successful refresh, partial failure, overlapping refresh rejection, expired connections, stale provider tool IDs, and write-capable source rejection.

### Phase 5: Product polish

1. Add pinned state to list ordering and detail header.
2. Add connector badges/icons on cards and tiles.
3. Add “Open creating chat.”
4. Add better artifact creation prompt from the empty state.
5. Consider simple PDF export if the desktop/web stack has an obvious print path.

## 11. Testing Plan

### Controller

- Storage migration tests for artifact tables.
- CRUD route tests in `apps/controller/src/routes/live-artifacts.test.ts`.
- Tool tests for `create_live_artifact` confirmation and sanitization.
- Refresh tests for:
  - no source tiles
  - read-only source success
  - connector/tool failure
  - write-capable source requiring confirmation
  - deleted/missing connector connection
  - expired/revoked connector connection
  - stale provider tool ID or schema mismatch
  - oversized render/source JSON rejection
  - malicious render payloads and unsafe links
  - overlapping refresh for the same artifact

### Web UI

- Sidebar active state tests.
- `/artifacts` empty/list states.
- Artifact detail tile rendering for each supported kind.
- Refresh button loading/error states.
- `New artifact` seeded prompt behavior.
- Unsafe URL/script payloads do not render as active content.
- Artifact list ordering: pinned first, then most recently updated/refreshed.
- Disconnected/expired connector state is visible on cards and detail pages.

### Manual QA

1. Configure model provider and connector provider.
2. Connect at least one read-only-capable app such as GitHub/Notion/Figma through Composio.
3. Click `Live Artifacts` → `New artifact`.
4. Ask for a status tracker or morning check-in.
5. Confirm artifact creation.
6. Open the artifact detail page.
7. Refresh it and verify timestamps/data update.
8. Restart the app and verify the artifact persists.

## 12. Open Questions

1. Should artifact creation always be tied to a chat session, or can `/artifacts/new` host its own creation chat?
2. Should v0.1 store raw connector outputs for debugging, or only mapped render JSON? Recommended: store only mapped render JSON plus small redacted provenance.
3. Should refresh use LLM summarization in v0.1? Recommended: avoid by default; add later for complex outputs.
4. Should structured choice cards be implemented as a general chat part type now? Recommended: defer; simulate with text and normal chat until artifact CRUD/refresh works.
5. Should artifacts live in session workspaces as files? Recommended: no for v0.1; use SQLite as source of truth and optionally export later.

## 13. Success Criteria

1. User can find **Live Artifacts** from the sidebar.
2. User can create an artifact from chat with explicit confirmation.
3. Artifact persists locally and appears on `/artifacts` after restart.
4. Artifact detail page renders useful live-data tiles.
5. Manual refresh re-runs read-only tile sources and updates the UI.
6. No connector credentials are exposed to the renderer or stored in artifact records.
7. Read-only tool calls run without approval prompts, while writes and unknown/unclassified actions still require confirmation.

## 14. Implementation Risks

1. **Approval risk:** existing approval flow is chat-run-based; artifact refresh needs an explicit grant model and must enforce `auto-approve read-only; confirm writes/unknown` consistently.
2. **Audit risk:** direct refresh execution could bypass `tool_calls` persistence unless refresh creates a synthetic run/tool-call record or equivalent artifact-refresh audit records.
3. **Privacy risk:** artifacts persist connector-derived data longer than a chat message might imply; source inputs and render JSON need redaction, minimization, and size limits.
4. **Connector stability risk:** provider tool IDs/schemas may change; stored tile sources need validation and graceful failure.
5. **UX risk:** `New artifact` seeded prompt must integrate cleanly with the existing session/composer flow.
6. **Testability risk:** LLM-based refresh mapping would make v0.1 flaky; deterministic mappers are required initially.
7. **Migration risk:** migration journal updates, constraints, and indexes should be included up front because tightening SQLite schema later is harder.
