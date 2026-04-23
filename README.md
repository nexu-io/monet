# Monet

Monet is an Electron-first desktop app scaffold for a local AI agent experience. The current repository layout follows the initial architecture in `specs/2026-04-23-initial-plan/spec.md`: Electron hosts a statically exported Next.js renderer and talks to a local Hono controller over authenticated localhost HTTP.

## Architecture

- `apps/desktop`: Electron main and preload processes, single-instance startup, and local controller orchestration.
- `apps/web-ui`: Next.js App Router UI exported to static assets for desktop packaging.
- `apps/controller`: Hono-based local API server with bearer-token auth and OpenAPI output.
- `packages/shared`: shared IDs, record types, and common utilities.
- `packages/database`: Drizzle and SQLite schema plus migration commands.
- `packages/agent-core`, `packages/tools`, `packages/providers`, `packages/ui`: reserved package boundaries for the next milestones.

## Workspace Layout

```text
.
├─ apps/
│  ├─ controller/
│  ├─ desktop/
│  └─ web-ui/
├─ packages/
│  ├─ agent-core/
│  ├─ database/
│  ├─ providers/
│  ├─ shared/
│  ├─ tools/
│  └─ ui/
├─ specs/
├─ package.json
└─ pnpm-workspace.yaml
```

## Requirements

- Node.js `>= 24`
- pnpm `10.8.1`

## Commands

From the repository root:

- `pnpm install`: install all workspace dependencies.
- `pnpm install:check`: verify the lockfile-backed install path with `--frozen-lockfile`.
- `pnpm check:openapi`: regenerate `apps/controller/openapi.json` and fail if the committed artifact is stale.
- `pnpm build`: build the controller, web UI export, and desktop bundles needed by the current scaffold.
- `pnpm pack:desktop`: build the workspace and assemble an unpacked Electron app under `dist/desktop/` for packaging validation.
- `pnpm dist:desktop`: build the workspace and produce desktop artifacts with `electron-builder` under `dist/desktop/`.
- `pnpm typecheck`: run TypeScript checks across every workspace package that currently has sources.
- `pnpm dev`: start the controller, Next.js dev server, and Electron desktop app using the shared local dev token `monet-dev-token`.
- `pnpm dev:controller`: run the Hono controller only on `127.0.0.1:3030`.
- `pnpm dev:web`: run the Next.js renderer only on `127.0.0.1:3000`.
- `pnpm dev:desktop`: build the desktop TypeScript entrypoints once and launch Electron against the local dev controller and renderer.
- `pnpm db:generate`: generate Drizzle migrations for `@monet/database`.
- `pnpm db:migrate`: apply Drizzle migrations for `@monet/database`.

## Development Notes

- The current `pnpm dev` flow uses a fixed local bearer token for convenience while the scaffold is being assembled. Production startup still generates an ephemeral token in Electron.
- `pnpm dev:desktop` performs a one-time TypeScript build before launching Electron. If you change files under `apps/desktop/src`, rerun `pnpm build:desktop` or restart `pnpm dev`.
- `apps/web-ui` uses `output: 'export'`, so production renderer assets are emitted to `apps/web-ui/out` during `pnpm build`.
- The desktop app expects the built controller entrypoint at `apps/controller/dist/electron-entry.js` and the exported renderer entrypoint at `apps/web-ui/out/index.html`.
- Desktop packaging is configured in `apps/desktop/package.json`: Electron Builder packages `apps/desktop/dist`, bundles controller, renderer, and migration assets into `app.asar`, runs native dependency alignment via `electron-builder install-app-deps`, and flips Electron fuses for packaged builds.
- Managed desktop launches pin SQLite to `app.getPath('userData')/sqlite/monet.db`; on POSIX hosts Monet best-effort chmods the database directory to `0700` and the database, WAL, and SHM files to `0600`.

## Release Notes

- macOS signing/notarization settings live in `apps/desktop/package.json` and use entitlements from `apps/desktop/resources/`.
- Windows packaging targets NSIS and is ready for certificate-based signing once CI secrets are added.
- The rollout plan for signing and notarization lives in `docs/release/signing-and-notarization.md`.

## Current Status

Milestone 0 scaffolding is in place for the monorepo, shared packages, local controller, web UI shell, and Electron host. The next implementation steps are focused on wiring persistence, chat execution, and tool workflows on top of this foundation.
