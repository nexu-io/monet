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
- `pnpm build`: build the controller, web UI export, and desktop bundles needed by the current scaffold.
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

## Current Status

Milestone 0 scaffolding is in place for the monorepo, shared packages, local controller, web UI shell, and Electron host. The next implementation steps are focused on wiring persistence, chat execution, and tool workflows on top of this foundation.
