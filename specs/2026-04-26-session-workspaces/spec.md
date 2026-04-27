# Per-Session Workspace Sandbox Implementation Spec

## 1. Background

`read_file` and `write_file` currently rely on an authorized directory allowlist. This protects user files, but it creates a poor default experience for simple file-generation tasks:

- `write_file("hello.html")` can fail when no authorized directories are configured.
- Resolving relative paths against controller `cwd` or the first authorized directory is surprising.
- Defaulting authorized directories to `process.cwd()` makes the app more usable, but it broadens access to a directory that may contain real project files.
- `write_file` currently requires confirmation even for harmless scratch/generated files.

The desired product behavior is:

> Each chat/session gets a dedicated local workspace. Agents can freely read and write inside that workspace without user confirmation. Access to real user/project files remains explicitly authorized and guarded.

## 2. Decision

Adopt a **per-session workspace sandbox** as the default filesystem working directory for agent file tools.

The session workspace is not a replacement for authorized directories. It is a safe, bounded area for files created by the current chat.

Recommended permission model:

| Path zone | `read_file` | `write_file` |
| --- | --- | --- |
| Current session workspace | Allowed | Allowed without confirmation |
| Existing authorized directories | Allowed | Requires confirmation |
| Outside both | Denied | Denied |

Long-term, once session workspaces are implemented, remove `process.cwd()` as the default authorized directory and return to:

```txt
authorized directories = []
session workspace = always available
```

Resolved implementation decision for workspace directory names:

- Use the raw session ID as the workspace directory segment after strict validation, rather than hashing or encoding it.
- A valid workspace session directory name must match the generated Monet session ID shape: `ses_` followed only by lowercase ASCII letters and digits (`^ses_[a-z0-9]+$`).
- Do not rely on the current weak `isMonetId` prefix-only check for filesystem paths.
- If a session ID fails this filesystem-safe validation, reject workspace path generation with a clear error instead of deriving a path from the unsafe value.
- This keeps workspace paths stable, human-recognizable, and compatible with existing generated session IDs while still preventing path separators, traversal components, shell metacharacters, and platform-problematic characters from becoming path segments.

Resolved implementation decision for workspace write limits:

- Use a default per-session workspace quota of **100 MB**.
- Use a default max single `write_file` content size of **1,000,000 bytes**.
- Enforce both limits before performing a workspace write that can skip confirmation.
- The 100 MB quota keeps confirmation-free writes bounded while still being large enough for generated HTML, images/assets, reports, and small project artifacts.
- The 1,000,000 byte single-write limit matches the existing `read_file` and `fetch_url` byte limit style in the controller, avoids introducing a larger unreviewed payload path, and can be made configurable later if product needs require larger generated files.

## 3. Goals

1. **Reliable default writes**
   - A request such as “create `hello.html`” should succeed without prior settings configuration.

2. **Least-privilege filesystem access**
   - Generated/scratch files live in a sandbox.
   - Real user files remain protected by explicit authorization and write confirmation.

3. **Predictable relative paths**
   - Relative paths resolve to the current session workspace, never controller cwd, app cwd, repo root, home directory, or first authorized directory.

4. **Strong escape protection**
   - `..` traversal and symlink escapes must not bypass the sandbox or allowlist.

5. **Clear lifecycle and UX**
   - Users can find, open, export, and delete files produced by a session.

## 4. Non-goals

1. Do not add a general shell tool.
2. Do not grant agents broad home-directory or project-directory write access by default.
3. Do not silently write to user/project files without confirmation.
4. Do not make one session’s workspace implicitly accessible to another session.
5. Do not build a full virtual filesystem abstraction unless the concrete filesystem approach proves insufficient.

## 5. Target Architecture

### 5.1 Workspace location

Store session workspaces under the app user-data directory, not under the repo or controller cwd.

Recommended path shape:

```txt
<MONET_USER_DATA_DIR>/session-workspaces/<validated-session-id>/workspace/
```

Examples:

```txt
/Users/<user>/Library/Application Support/Monet/session-workspaces/ses_abc123/workspace/
```

For dev controller runs without `MONET_USER_DATA_DIR`, use the same base as other controller local data:

```txt
<process.cwd()>/session-workspaces/<validated-session-id>/workspace/
```

The base path must be configurable through controller config so Electron can pass the correct user-data path.

### 5.2 Path zones

Filesystem tool path resolution should classify every requested path into one of three zones:

```ts
type FilesystemPathZone = "session_workspace" | "authorized_directory" | "denied";

interface ResolvedFilesystemPath {
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly zone: FilesystemPathZone;
  readonly requiresConfirmation: boolean;
}
```

Rules:

1. Relative paths resolve against the current session workspace.
2. Absolute paths are allowed if they resolve inside the current session workspace.
3. Absolute paths are allowed if they resolve inside an authorized directory.
4. Everything else is denied.
5. Writes to the session workspace do not require confirmation.
6. Writes to authorized directories require confirmation.

### 5.3 Tool behavior

#### `read_file`

- Relative path: read from current session workspace.
- Absolute path in session workspace: read without confirmation.
- Absolute path in authorized directory: read without confirmation.
- Outside both: reject.

#### `write_file`

- Relative path: write to current session workspace without confirmation.
- Absolute path in session workspace: write without confirmation.
- Absolute path in authorized directory: require confirmation.
- Outside both: reject.

## 6. Security Requirements

### 6.1 Canonical path enforcement

Authorization and confirmation decisions must use canonical/resolved paths, not raw strings.

Required handling:

- Trim empty path input and reject empty paths.
- Normalize and resolve paths.
- For existing paths, use `realpath`.
- For non-existing write targets, resolve the nearest existing parent and append the remaining relative suffix.
- Reject symlink escapes from the session workspace or authorized directories.
- Reject `../` traversal that escapes the session workspace.

### 6.2 Cross-session isolation

A session may only access its own workspace by default.

If a user intentionally adds another session workspace to authorized directories, it should behave like any other authorized directory and require write confirmation.

### 6.3 Quotas

Add quotas before or shortly after enabling confirmation-free writes.

Initial limits:

- Per-session workspace quota: 100 MB.
- Max single `write_file` content size: 1,000,000 bytes.
- Optional global workspace quota: defer for MVP; consider 1–5 GB later if orphan cleanup and user-facing storage management are not sufficient.

If quota is exceeded, fail the tool with a clear error:

```txt
Session workspace quota exceeded.
```

### 6.4 Permissions

Create workspace directories with restrictive permissions where supported:

```ts
mkdir(path, { recursive: true, mode: 0o700 })
```

Do not rely on permissions as the only sandbox boundary; still enforce canonical path checks.

## 7. Data Lifecycle

### 7.1 Creation

Create the session workspace lazily on first file operation or eagerly when a session is created.

Lazy creation is preferred for MVP:

- avoids empty directories for sessions that never use files;
- keeps migration simpler;
- still gives deterministic paths when needed.

### 7.2 Retention

Keep the workspace for as long as the session exists.

Do not silently delete active session files, because generated artifacts may be part of the conversation’s output.

### 7.3 Deletion

When a session is deleted, delete its workspace recursively.

Also add a separate “Delete workspace files” action later so users can clear large files without deleting chat history.

### 7.4 Orphan cleanup

On startup, optionally scan `session-workspaces/` and remove workspaces that no longer correspond to a session record.

This cleanup should be conservative and logged.

## 8. UX Requirements

### 8.1 User-facing workspace controls

Add session-level UI affordances:

1. Show “Session workspace” in the session/chat UI.
2. Provide “Open workspace folder”. On macOS this must open the current session workspace directory in Finder.
3. Provide “Copy workspace path”.
4. Make successful `write_file` output paths clickable/openable where possible.
5. Surface actual tool error details, not only generic text like “Couldn't write hello.html.”

### 8.4 macOS Finder integration

Each session should expose an explicit action to reveal/open its workspace directory in macOS Finder.

Required behavior:

- The action is session-scoped: invoking it for session A opens session A's workspace, not a global workspace root or the last-used session workspace.
- If the workspace directory does not exist yet, create it before opening Finder. This makes the action reliable even before the first file tool call.
- Use the native Electron/desktop shell integration where available, e.g. `shell.openPath(workspacePath)` or `shell.showItemInFolder(workspacePath)` if a file should be revealed.
- Prefer opening the workspace directory itself for the session-level action.
- If the app is not running in the macOS desktop environment, hide/disable the Finder-specific label and use a generic “Open workspace folder” action only when supported.
- If Finder/opening fails, show a clear error that includes the workspace path and the underlying failure reason.
- Never accept an arbitrary renderer-provided path for this action. The main process/controller must derive the workspace path from the session ID.

### 8.2 Agent-facing context

The agent system/developer prompt should include the current workspace path:

```txt
Your working directory for this session is:
<session-workspace-path>

Relative paths resolve there. You may read and write files there freely.
Writing outside this workspace requires user authorization/confirmation.
```

This prevents ambiguity about where generated files go.

### 8.3 Settings interaction

Keep “Authorized directories” in settings, but clarify its purpose:

> Session files are stored in the session workspace. Add authorized directories only when you want the agent to read or modify real files outside the session workspace. Writes outside the session workspace still require confirmation.

### 8.5 Post-MVP file browser and export behavior

Resolved post-MVP decision:

- The MVP UI should keep the existing explicit “Open workspace folder” and “Copy workspace path” controls rather than adding an in-app file browser.
- A future in-app file browser, if added, must be scoped to the current session workspace only. It must not browse authorized external directories, other session workspaces, repo roots, home directories, or the global workspace base by default.
- The browser should derive the workspace path server-side from the session ID, use the same canonical containment checks as file tools, and treat actions that mutate files as session-workspace-only actions.
- Exported chats must not include workspace files by default. Export should include conversation data by default and expose an explicit opt-in checkbox such as “Include session workspace files.”
- When workspace files are included, the export should preserve relative workspace paths and include a manifest. Large exports should show size/count details before confirmation.
- External authorized-directory files are never bundled into chat exports unless a separate, explicit future feature is designed for that purpose.

## 9. API and Data Model Changes

### 9.1 Controller config

Add controller config for workspace base directory:

```ts
interface ControllerConfig {
  readonly sessionWorkspaceBaseDirectory: string;
}
```

Suggested resolution:

1. `MONET_SESSION_WORKSPACE_DIR`, if set.
2. `MONET_USER_DATA_DIR/session-workspaces`, if `MONET_USER_DATA_DIR` is set.
3. `process.cwd()/session-workspaces` for local dev fallback.

### 9.2 Session workspace service

Add a small controller service responsible for path creation and lookup:

```ts
interface SessionWorkspaceService {
  getWorkspacePath(sessionId: string): string;
  ensureWorkspace(sessionId: string): Promise<string>;
  deleteWorkspace(sessionId: string): Promise<void>;
  listWorkspaceMetadata(sessionId: string): Promise<SessionWorkspaceMetadata>;
}
```

The service must validate session IDs before using them in paths. Use raw session IDs as path segments only when they match `^ses_[a-z0-9]+$`; otherwise fail workspace path generation with a clear invalid session ID error. Do not hash or encode unsafe session IDs for MVP, because generated Monet session IDs already satisfy the safe path-segment contract and raw validated IDs make workspace paths stable and easier to inspect.

### 9.3 Tool execution context

Thread `sessionId` and workspace path into tool execution.

Current tool context already includes run and tool call IDs. Extend it with:

```ts
interface ToolExecutionContext {
  readonly sessionId: string;
  readonly sessionWorkspacePath: string;
}
```

If the current runtime only has `runId`, resolve `sessionId` from the run/session storage layer before creating runtime tools.

### 9.4 Tool metadata / dynamic approval

`write_file` currently has static `requiresConfirmation: true`. The sandbox model requires dynamic approval based on resolved path zone.

Resolved AI SDK compatibility decision:

- The project is on AI SDK `ai@6.0.168`, which supports dynamic tool approval through `tool({ needsApproval })`.
- `needsApproval` may be a function evaluated per tool call from the parsed tool input and execution context, so the controller can classify the requested path server-side and return `true` only for confirmed external authorized-directory writes.
- Use the preferred single-`write_file` dynamic approval design for Phase 3 rather than splitting the public tool surface.
- Keep execution-time path reclassification in `execute`; the approval predicate is for confirmation UX/routing and must not be the only enforcement point.

Implementation options:

1. **Preferred:** make tool approval dynamic, e.g. `needsApproval(input, context)` can classify the path and return `true` only for authorized-directory writes.
2. **MVP fallback:** split tools internally or expose a separate no-confirm sandbox write tool. This is less ideal because it complicates model/tool UX.

Use the preferred dynamic approval model if compatible with the AI SDK tool API used by the project.

### 9.5 Open workspace API

Add a session-scoped API for opening a workspace from the desktop UI:

```ts
interface SessionWorkspaceActions {
  openWorkspaceDirectory(sessionId: string): Promise<void>;
}
```

Implementation requirements:

- Validate that `sessionId` refers to an existing session visible to the current user/context.
- Resolve the workspace path through `SessionWorkspaceService`; do not trust a path supplied by the renderer.
- Ensure the workspace directory exists before opening it.
- In Electron, handle the actual Finder operation in the main process using the native `shell` API.
- Return structured errors to the renderer so UI can display actionable failure details.

## 10. Implementation Plan

### Phase 1 — Foundation

1. Add session workspace config resolution.
2. Add `SessionWorkspaceService`.
3. Add tests for workspace path generation and directory creation.
4. Thread `sessionId` into runtime tool creation.

### Phase 2 — Path classification

1. Replace the current `resolveAuthorizedPath` helper with a classifier that accepts:
   - requested path;
   - access mode;
   - current session workspace path;
   - authorized directories.
2. Resolve relative paths against the session workspace.
3. Preserve existing symlink escape protections.
4. Return zone metadata for logging and tool output.

### Phase 3 — Confirmation model

1. Make `write_file` approval dynamic if supported.
2. Skip approval for `session_workspace` writes.
3. Keep approval for `authorized_directory` writes.
4. Deny writes outside both.

### Phase 4 — Lifecycle integration

1. Delete workspace on session deletion.
2. Add conservative orphan cleanup.
3. Add quota checks.

### Phase 5 — UX and prompt updates

1. Add session workspace display/open/copy controls.
2. Improve tool failure UI to show backend error details.
3. Add workspace path to agent context.
4. Update settings copy for authorized directories.

### Phase 5.5 — macOS Finder integration

1. Add the session-scoped `openWorkspaceDirectory(sessionId)` IPC/API endpoint.
2. Wire the session UI “Open workspace folder” action to the endpoint.
3. On macOS desktop builds, label the action as opening in Finder or otherwise make clear that Finder will open.
4. Ensure the endpoint creates the workspace directory if it does not yet exist.
5. Show clear UI errors if the native open operation fails.

### Phase 6 — Remove unsafe temporary default

After the sandbox is working:

1. Revert default authorized directories from `process.cwd()` back to `[]`.
2. Keep env-configured `MONET_TOOL_ALLOWED_DIRECTORIES` behavior.
3. Preserve existing persisted authorized directory behavior.

## 11. Test Plan

### 11.1 Unit tests

Path classification:

- `hello.html` resolves to current session workspace.
- `nested/file.txt` resolves to current session workspace.
- `../escape.txt` is rejected.
- absolute path inside session workspace is allowed.
- absolute path inside authorized directory is allowed.
- absolute path outside both is rejected.
- symlink inside workspace pointing outside is rejected.
- symlink inside authorized directory pointing outside is rejected.

Tool behavior:

- `read_file` reads relative files from workspace.
- `write_file` writes relative files to workspace.
- workspace writes do not require confirmation.
- authorized-directory writes require confirmation.
- denied writes fail with a clear error.

Lifecycle:

- workspace is created lazily.
- deleting a session removes the workspace.
- orphan cleanup ignores active sessions.
- quota failure prevents writes beyond the configured limit.

Open workspace action:

- `openWorkspaceDirectory(sessionId)` derives the path from the session ID, not renderer input.
- opening a workspace for an existing session ensures the directory exists first.
- invalid or inaccessible session IDs are rejected.
- native open failures are propagated as structured errors.

### 11.2 Integration tests

- Create a session, ask agent to write `hello.html`, verify file exists in that session workspace.
- Create two sessions, verify session A cannot access session B workspace via relative paths.
- Add a project directory to authorized directories, verify writes there still require confirmation.
- Restart controller, verify existing session workspace path remains stable.
- From the desktop UI, invoke “Open workspace folder” for two different sessions and verify each action targets that session's workspace path.

### 11.3 Manual QA

- Use desktop app to create a simple HTML file.
- On macOS, open the session workspace folder from UI and confirm Finder opens to that session's workspace directory.
- Confirm generated file appears.
- Create another session and confirm its “Open workspace folder” action opens a different Finder location.
- Try writing to a real project file and verify confirmation appears.
- Remove a session and verify workspace cleanup.

## 12. Migration and Compatibility

Relative file-tool paths now mean “inside the current session workspace.” A request like `write_file("hello.html")` must create or update:

```txt
<session-workspace-base>/<validated-session-id>/workspace/hello.html
```

and must not resolve against controller `cwd`, the repo root, the user's home directory, or the first authorized directory.

Existing sessions may not have workspace directories yet. That is acceptable: derive the workspace path from the existing session ID, validate the ID with the filesystem-safe session ID rules, and create the directory lazily when a file tool or workspace-open action first needs it. This preserves stable paths across restarts without adding a migration that eagerly creates directories for every historical session.

Existing authorized directories should keep working.

Compatibility requirements:

- Preserve persisted authorized directories across the migration.
- Preserve `MONET_TOOL_ALLOWED_DIRECTORIES` behavior for deployments that intentionally grant external read/write scope.
- Do not keep `process.cwd()` as an implicit default authorized directory once session workspace writes are available; the default external allowlist is `[]`.
- External authorized-directory reads remain allowed, and external authorized-directory writes still require confirmation.
- A workspace belonging to another session is not accessible by default. It is treated like any other external path unless the user explicitly authorizes it, and writes there require confirmation.

Temporary compatibility path:

1. Keep current authorized directory behavior while adding session workspaces.
2. Once workspaces are available and relative writes succeed, remove the `process.cwd()` default authorization.
3. Document that relative paths now mean “inside the current session workspace.”

## 13. Open Questions

1. Resolved: workspace directories should use raw session IDs after strict filesystem-safe validation (`^ses_[a-z0-9]+$`), not hashed directory names.
2. Resolved: default per-session workspace quota is 100 MB, and max single `write_file` content size is 1,000,000 bytes.
3. Resolved: keep only “Open workspace folder” and “Copy workspace path” for MVP. Any future in-app file browser must be scoped to the current session workspace only and must not browse authorized external directories or other sessions by default.
4. Resolved: exported chats should not include workspace files by default. Add an explicit opt-in checkbox for including session workspace files, with size/count details and relative-path preservation when enabled.
5. Resolved: current AI SDK `ai@6.0.168` supports dynamic `needsApproval` based on resolved input and execution context; use the preferred dynamic `write_file` approval path.

## 14. Acceptance Criteria

1. A new session can write `hello.html` with no prior authorized-directory setup.
2. The file is created under that session’s workspace.
3. The write does not prompt for confirmation.
4. Writing to an authorized external directory still prompts for confirmation.
5. Writing outside the workspace and allowlist is denied.
6. Relative paths never resolve to controller cwd or repo root.
7. Symlink and `..` escapes are rejected.
8. Users can open/copy the session workspace path from the UI.
9. On macOS desktop builds, users can open each session's workspace directory in Finder from that session's UI.
10. The Finder action derives the workspace path from the session ID and does not trust renderer-supplied paths.
11. Session deletion cleans up the workspace.
12. Tests cover path classification, tool behavior, lifecycle cleanup, and workspace-open behavior.
