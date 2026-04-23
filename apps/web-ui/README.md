# @monet/web-ui

Next.js App Router renderer for the Electron desktop shell.

## Component Reuse Constraints

`apps/web-ui` must stay aligned with the Nexu design system instead of growing a parallel local UI kit.

- Always use `@nexu-design/tokens` for color, spacing, radius, typography, and similar visual primitives.
- Prefer `@nexu-design/ui-web` whenever it already provides the structure or interaction you need.
- Add a local wrapper component only when the missing piece is Monet-specific composition, data binding, or app behavior.
- Do not introduce one-off JSX + CSS replacements for components that already exist in Nexu.

### Reuse Nexu Directly

Use Nexu components directly when the problem is mostly presentational and the component API already fits.

- Layout and page chrome: `PageHeader`, `Card`, `Badge`, `NavItem`
- Basic actions and state affordances: `Button`, `StatusDot`
- Repeated content blocks that only need local copy or local data mapping

Current examples:

- `src/components/page-frame.tsx` uses `PageHeader` directly for page-level framing.
- `src/components/app-shell.tsx` uses `Card`, `Badge`, and `NavItem` directly for sidebar chrome.
- `src/components/controller-status-card.tsx` uses `Card`, `Badge`, `Button`, and `StatusDot` directly for a standard status surface.

### Add a Local Wrapper

Add a local component in `src/components` when the UI is still built from Nexu primitives but Monet needs a stable app-level abstraction.

- The component packages multiple Nexu primitives into one repeated Monet pattern.
- The component owns controller-specific loading, error, empty, or streaming states.
- The component translates domain models into a design-system surface.
- The component needs a single Monet API so future chat/session screens do not duplicate assembly logic.

Good local wrapper examples in the current codebase:

- `PageFrame`: wraps `AppShell` and `PageHeader` into one page scaffold.
- `ControllerStatusCard`: keeps fetch logic and health-state rendering out of route files while still rendering with Nexu primitives.

### Do Not Add a Wrapper Yet

Do not add a wrapper when:

- The usage appears in only one place and simple composition is enough.
- The wrapper would only rename a Nexu component without adding Monet behavior.
- The missing change is just spacing, density, or token-backed styling that can be handled with existing classes and tokens.

### Escalation Rule

If a required component seems missing from `@nexu-design/ui-web`, check the Nexu source at `~/Projects/nexu-io/design` before inventing a local substitute. Only after confirming the gap should `apps/web-ui` add a local wrapper or temporary composition.
