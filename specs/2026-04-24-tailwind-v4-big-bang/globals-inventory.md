# `apps/web-ui/src/app/globals.css` inventory

This inventory is the pre-implementation map for the Tailwind v4 big-bang migration. It maps the current global selectors to React-controlled files, identifies token/theme contracts that Tailwind must expose, and defines the CSS that is allowed to remain global after component classes are migrated.

## Selector family map

| CSS family / selectors | Current TSX usage | Migration note |
| --- | --- | --- |
| Imports: `@nexu-design/tokens/styles.css`, `@nexu-design/ui-web/styles.css` | Imported only by `apps/web-ui/src/app/globals.css`. | Must remain global; Tailwind import is added after these unless visual verification requires a documented change. |
| Base/theme: `:root`, `html[data-theme="light"]`, `html[data-theme="dark"]`, `*`, `html`, `body`, `a`, `button`, `input`, `select`, `textarea` | `apps/web-ui/src/app/layout.tsx` sets the root `html` `data-theme`; all pages consume ambient base styles. | Must remain global, moved under `@layer base` once Tailwind is installed. |
| Utilities: `.mono`, `.sr-only` | `.mono`: `components/composer.tsx`, `components/welcome-home.tsx`, `components/chat-thread.tsx`, `components/settings-panel-content.tsx`. `.sr-only`: `components/composer.tsx`, `components/welcome-home.tsx`. | Prefer Tailwind `font-mono` and `sr-only`; keep only if external/non-React markup needs them. |
| Shell/sidebar: `.shell`, `.sidebar`, `.sidebar-drag-region`, `.sidebar-top`, `.sidebar-bottom`, `.sidebar-brand*`, `.sidebar-cta`, `.sidebar-section*`, `.sidebar-nav-link`, `.sidebar-recent-*`, `.sidebar-status*`, `.sidebar-settings-link*`, plus `data-desktop-shell` / `data-active` states | `components/app-shell.tsx`. | Convert to direct utilities and data variants. `.sidebar-nav` exists in CSS but is not referenced. |
| Main canvas/page intro: `.main-canvas`, `.canvas-header`, `.canvas-body`, `.canvas-scroll`, `.canvas-composer`, `.page-intro` and descendant `h1`/`p` | `components/app-shell.tsx`, `components/page-frame.tsx`. | Convert wrapper classes to utilities. Descendant heading/copy styles should become direct classes in `PageHeader`/call sites where controlled. |
| Welcome: `.welcome`, `.welcome-hero`, `.welcome-badge`, `.welcome-greeting*`, `.welcome-subtitle`, `.welcome-composer*`, `.welcome-grid`, `.welcome-section*`, `.welcome-info-card*`, `.welcome-recent-card*` | `components/welcome-home.tsx`. | Convert all to component utilities; `kbd` styling can be direct child classes or a small `KeyboardHint` component. |
| Conversation header: `.conversation-header*`, target picker `select` hover/focus descendants | `components/conversation-header.tsx`. | Convert to utilities. `status-inline` is used in TSX but currently has no CSS rule; do not preserve as a global. |
| Composer: `.composer`, `.composer-input`, `.composer-footer`, `.composer-hints`, `.composer-actions`, `kbd` descendant | `components/composer.tsx`. | Convert to utilities; placeholder/focus-within can use Tailwind variants. |
| Chat thread/message: `.chat-thread-layout`, `.chat-thread`, `.chat-thread-jump`, `.chat-message*`, `.chat-message-card`, `.chat-message-parts`, `.message-text` | `app/page.tsx`, `components/chat-thread.tsx`. | Convert to utilities/data variants. `chat-empty-state` and `chat-error-card` are used in TSX but have no CSS rule; migrate or normalize them during chat slice. |
| Chat generated/detail cards: `.reasoning-block`, `.step-start`, `.attachment-card`, `.source-card`, `.tool-card`, `.unknown-part-card`, `.attachment-label`, `.tool-card-*`, tool `data-tool-phase` states, `pre`/`strong` descendants | `components/chat-thread.tsx`. | Controlled wrappers should become utilities. Keep only genuinely rendered/uncontrolled `pre`/code/content residuals if direct markup classes are impractical. |
| Shared layout/type helpers: `.stack`, `.stack-tight`, `.muted`, `.eyebrow`, `.grid`, `.split`, `.page-intro`, `.feature-list`, `.kv-list`, `.status-list`, `.session-list`, `.settings-list` | Heavy use in `app/settings/layout.tsx`, `components/settings-panel-content.tsx`, `app/sessions/page.tsx`, `components/app-shell.tsx`; `.grid`, `.split`, `.feature-list`, `.status-list`, `.session-list` appear unused in current TSX. | First JSX migration slice should replace these with utilities/components so later slices do not depend on generic globals. |
| Shared surfaces/status: `.card`, `.card-muted`, `.hero`, `.hero-copy`, `.pill-row`, `.pill`, `.status-badge`, `[data-slot="card-title"]`, `[data-slot="badge"]`, `[data-slot="status-dot"]` | `.card`, `.card-muted`, `.status-badge` are used broadly in settings/sessions/chat. `.hero`, `.hero-copy`, `.pill-row`, `.pill` appear unused. Slot selectors target runtime output from `@nexu-design/ui-web` primitives. | Convert controlled card/badge usage to utility classes or small React wrappers. Audit each `data-slot` selector before retaining. |
| Sessions: `.session-browser-layout`, `.session-browser-list`, `.session-browser-item*`, `.session-browser-actions`, `.session-detail-*`, `.session-action-button*` | `app/sessions/page.tsx`; `.session-action-button*` also in `app/page.tsx`. `.session-browser-empty` appears unused. | Convert all controlled markup to utilities; preserve active/hover states with data/hover variants. |
| Settings shell: `.settings-page*`, `.settings-page-tabs*`, `.settings-page-tab-trigger*`, `.settings-page-tab-content*` | `app/settings/layout.tsx`. | Convert to utilities; tab active indicator can use `after:` utilities or direct indicator element. |
| Settings content: `.settings-models-layout`, `.settings-general-layout`, `.settings-directory-list`, `.settings-theme-options`, `.settings-provider-*`, `.settings-model-*`, `.settings-validation-card`, `.settings-directory-*`, `.settings-theme-*`, `.settings-title-row`, `.settings-secret-*`, `.kv-inline-action`, `.settings-callout-card` | `components/settings-panel-content.tsx`. `settings-provider-list-card` is used in TSX but has no CSS rule. | Convert with utilities; keep theme swatch gradients local or use arbitrary background values because they are illustrative previews. |
| Focus/ui overrides: `.nav-link:focus-visible`, `.sidebar-nav-link:focus-visible`, `.sidebar-recent-item:focus-visible`, `.chat-thread-jump [data-slot="button"]`, `.settings-directory-item [data-slot="button"]` | `components/app-shell.tsx`, `components/chat-thread.tsx`, `components/settings-panel-content.tsx`. `.nav-link` appears unused. Slot selectors depend on primitive internals. | Convert focus on controlled elements to utilities. Keep only unavoidable primitive slot overrides. |
| Responsive rules: `@media (max-width: 960px)`, `@media (max-width: 640px)` | Affects shell, welcome, conversation, composer, chat, sessions, settings. | Use a custom Tailwind breakpoint for `960px` and normal `sm`/`max-sm` handling for `640px`; keep root variable override for `--app-page-padding-x`. |
| Keyframes: `@keyframes monet-pulse` | Referenced by `[data-slot="status-dot"][class*="animate-pulse"]`. | Keep globally unless replaced by Tailwind animation utilities with a token-backed theme mapping. |

## Required Tailwind token aliases

Tailwind must expose semantic names that point to `@nexu-design/tokens` variables instead of duplicating scales.

- Colors:
  - `surface-0`, `surface-1`, `surface-2`
  - `text-primary`, `text-secondary`, `text-tertiary`, `text-muted`, `text-placeholder`, `text-heading`
  - `border`, `border-subtle`, `border-strong`, `border-hover`
  - `accent`, `accent-foreground`
  - `success`, `success-subtle`, `warning`, `warning-subtle`, `error`, `error-subtle`, `destructive`
  - App aliases: `app-canvas`, `app-sidebar`, `app-card`, `app-card-muted`, `app-hover`
- Fonts: `sans`, `heading`, `mono`.
- Text sizes used today: `2xs`, `xs`, `sm`, `lg`, `xl`, `2xl`, `3xl`, plus arbitrary/clamp values where already present (`welcome-greeting`).
- Font weights: `medium`, `semibold`, `bold` mapped to token weights.
- Radii: `sm`, `md`, `lg`, `xl`, `2xl`, `full`.
- Shadows: `xs`, `sm`, `md`, `dropdown`, `focus`.
- Spacing: keep Tailwind spacing values aligned with `calc(var(--spacing) * n)`. Current CSS uses fractional multipliers (`0.5`, `1.25`, `1.5`, `2.5`, `3.5`, `4.5`) and large app dimensions (`18`, `22`, `48`, `60`, `66`, `72`, `180`, `192`, `220`).
- Durations/easing used by existing transitions: `fast`, `normal`, `standard` if Tailwind v4 theme variables are added for readable transition utilities.

## Custom breakpoints and responsive behavior

- Required custom breakpoint: `960px` for the current tablet/mobile collapse. Use Tailwind variants equivalent to `max-width: 960px` and `min-width: 961px` when preserving desktop shell behavior.
- Existing `640px` behavior should map to Tailwind's `sm` boundary where possible.
- Keep the `@media (max-width: 640px) { :root { --app-page-padding-x: ... } }` global variable override because it fans out to many descendants via `var(--app-page-padding-x)`.
- Responsive states to preserve: desktop two-column shell, sticky/scrolling sidebar on desktop, mobile single-column shell, canvas overflow changes, welcome/composer action stacking, session split collapse, settings provider/theme grids collapse, and settings directory button wrapping.

## Dark theme handling

- `app/layout.tsx` owns the initial `html[data-theme]` value; theme changes are managed by the theme provider.
- Keep global `html[data-theme="light"] { color-scheme: light; }` and `html[data-theme="dark"] { color-scheme: dark; }`.
- Preserve dark overrides currently in `globals.css`:
  - `--app-canvas-bg: var(--color-dark-bg)`
  - `--app-sidebar-bg: var(--color-surface-1)`
- Tailwind dark variants should target `html[data-theme="dark"]`, not only `.dark`, so utility classes can follow the app's existing theme attribute strategy.

## Prose/rendered content rules

There is no general `.prose` selector in the current stylesheet. The only prose-like residual candidates are chat/tool rendered content descendants:

- `.message-text` preserves `white-space: pre-wrap` for message text.
- `.reasoning-block summary` and `.reasoning-block p` are controlled today and should be migrated unless the rendered structure becomes uncontrolled.
- `.tool-card pre` and `.unknown-part-card pre` may remain global only if the code/pre nodes are generated without a reliable class hook. Prefer direct classes in `chat-thread.tsx` while migrating.
- Inline `code` styles in `.conversation-header-copy code` are controlled and should be direct utilities or a small inline-code component.

## `@nexu-design/ui-web` slot overrides to audit

Current slot overrides:

- `[data-slot="card-title"]`
- `.hero [data-slot="card-title"]` (likely removable; `.hero` appears unused)
- `[data-slot="badge"]`
- `[data-slot="status-dot"]` and `aria-label` tone variants
- `[data-slot="status-dot"][class*="animate-pulse"]`
- `.chat-thread-jump [data-slot="button"]`
- `.settings-directory-item [data-slot="button"]` inside the `640px` media query

No TSX file in `apps/web-ui/src` sets `data-slot` directly; these selectors target `@nexu-design/ui-web` primitive output. Keep only selectors that cannot be expressed through primitive props/className on controlled usage.

## Exact residual global CSS contract

After migration, `globals.css` must be limited to the following concerns. Any component/page selector outside this list requires an explicit note in the final audit.

```css
@import "@nexu-design/tokens/styles.css";
@import "@nexu-design/ui-web/styles.css";
@import "tailwindcss";

@theme inline {
  /* token-backed aliases listed above */
}

@custom-variant dark (&:where(html[data-theme="dark"], html[data-theme="dark"] *));

@layer base {
  :root {
    color-scheme: light dark;
    --app-shell-width: calc(var(--spacing) * 66);
    --app-content-max-width: calc(var(--spacing) * 220);
    --app-welcome-max-width: calc(var(--spacing) * 192);
    --app-page-padding-x: calc(var(--spacing) * 8);
    --app-page-padding-y: calc(var(--spacing) * 8);
    --app-section-gap: calc(var(--spacing) * 6);
    --app-canvas-bg: var(--color-surface-0);
    --app-sidebar-bg: var(--color-surface-1);
    --app-card-bg: var(--color-surface-1);
    --app-card-muted-bg: var(--color-surface-2);
    --app-hover-bg: var(--color-surface-2);
  }

  html[data-theme="light"] { color-scheme: light; }

  html[data-theme="dark"] {
    color-scheme: dark;
    --app-canvas-bg: var(--color-dark-bg);
    --app-sidebar-bg: var(--color-surface-1);
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    min-height: 100%;
  }

  body {
    background: var(--app-canvas-bg);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-size-lg);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
  }
}

@keyframes monet-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (max-width: 640px) {
  :root { --app-page-padding-x: calc(var(--spacing) * 4); }
}

/* Optional residuals only if justified during migration:
 * - rendered chat prose/pre/code selectors that cannot receive direct classes
 * - unavoidable @nexu-design/ui-web [data-slot="..."] overrides
 */
```

## Known stale/gap findings before migration

- CSS-defined but currently unreferenced or likely stale: `.sidebar-nav`, `.chat-support-grid`, `.feature-list`, `.grid`, `.hero`, `.hero-copy`, `.nav-link`, `.pill`, `.pill-row`, `.session-list`, `.split`, `.status-list`, `.session-browser-empty`.
- TSX-used but currently without a matching CSS rule: `.status-inline`, `.chat-empty-state`, `.chat-error-card`, `.settings-provider-list-card`.
- These findings should be used for class-aware cleanup; do not search broad terms like `card` or `grid` without class-token boundaries.
