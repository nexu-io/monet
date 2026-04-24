# Tailwind CSS v4 Big-Bang Adoption Plan for Web UI

## 1. Background

`apps/web-ui` currently relies on a single large global stylesheet:

- `apps/web-ui/src/app/globals.css` is about 1,800 lines.
- It imports `@nexu-design/tokens/styles.css` and `@nexu-design/ui-web/styles.css`.
- It defines app-level layout variables, base element styles, shell/sidebar/page/chat/settings styles, responsive rules, keyframes, and overrides for `@nexu-design/ui-web` primitive slots.
- The app package does **not** currently install or configure Tailwind CSS directly.

Because this is still a fresh project, we should prefer a decisive migration over a long incremental coexistence period. The goal is to make Tailwind v4 the default app styling language now, before the app surface area grows and the current stylesheet becomes harder to unwind.

## 2. Decision

Adopt **Tailwind CSS v4** in `apps/web-ui` using a **big-bang migration**:

1. Add Tailwind v4 and its PostCSS integration to `@monet/web-ui`.
2. Convert app-authored component/page styling from global CSS classes to Tailwind utilities in JSX/TSX.
3. Reduce `globals.css` to true global concerns only.
4. Keep `@nexu-design/tokens` as the design-token source of truth.
5. Keep `@nexu-design/ui-web` primitive styles imported and compatible.

This is intentionally not an incremental “new code only” adoption. Existing app styling should be migrated in one coordinated branch/PR so that the project lands in a clean Tailwind-first state.

## 3. Goals

### 3.1 Primary goals

1. **Tailwind-first app styling**
   - Most app layout, spacing, typography, state, and responsive styling should live in `className` strings or small class composition helpers.

2. **Token fidelity**
   - Tailwind utilities must resolve to `@nexu-design/tokens` CSS variables rather than introducing independent hard-coded design scales.

3. **Small global CSS**
   - `globals.css` should retain only imports, base styles, app CSS variables, theme handling, truly global content styles, keyframes, and unavoidable primitive overrides.

4. **No long-term dual system**
   - Avoid leaving half the app styled by `.welcome-*`, `.settings-*`, `.chat-*` classes and half by Tailwind utilities.

5. **Preserve current visual language**
   - The migration should preserve the existing soft, airy, token-driven design rather than redesigning the UI.

### 3.2 Non-goals

1. Do not replace `@nexu-design/tokens`.
2. Do not fork or rewrite `@nexu-design/ui-web`.
3. Do not introduce a separate visual design system in Tailwind config.
4. Do not use Tailwind migration as an opportunity for a broad product redesign.
5. Do not preserve every old global class for compatibility unless it is still referenced by external/generated markup.

## 4. Target Architecture

### 4.1 Styling layers

The final styling stack should be:

```text
@nexu-design/tokens/styles.css
  ↓
@nexu-design/ui-web/styles.css
  ↓
Tailwind v4 utilities generated for apps/web-ui
  ↓
Small apps/web-ui/src/app/globals.css residual layer
```

`globals.css` should remain the import root used by Next.js, but it should no longer be the main component styling surface.

### 4.2 Responsibilities

#### Tailwind utilities

Use for:

- component layout
- spacing
- typography
- colors
- borders
- radii
- shadows
- hover/focus states
- data-attribute states
- responsive variants
- one-off dimensions when they are local to a component

#### `globals.css`

Use for:

- `@import "@nexu-design/tokens/styles.css"`
- `@import "@nexu-design/ui-web/styles.css"`
- Tailwind v4 import/directives
- `:root` app-level variables such as shell width and page padding
- `html[data-theme="light"]` and `html[data-theme="dark"]` theme handling
- base `html`, `body`, `a`, `button`, `input`, `select`, `textarea` styles if not covered safely by Tailwind/preflight
- accessibility helpers that are used outside React-controlled markup, if any
- rendered rich text/prose rules where adding utilities to every descendant is impractical
- keyframes that are not worth moving into Tailwind theme config
- narrow overrides for `@nexu-design/ui-web` slots when the primitive API does not expose a better prop

#### React components/helpers

Use for repeated visual patterns, not global CSS classes.

Examples:

- `AppCard`
- `StatusBadge`
- `PageIntro`
- `SettingsSection`
- `ChatMessageCard`

If a Tailwind class string is repeated in more than two or three places, prefer a component or a typed variant helper instead of recreating `.card` via `@apply`.

## 5. Tailwind v4 Setup

### 5.1 Dependencies

Add to `apps/web-ui`:

```bash
pnpm --filter @monet/web-ui add -D tailwindcss @tailwindcss/postcss
```

If class composition becomes necessary, optionally add:

```bash
pnpm --filter @monet/web-ui add clsx tailwind-merge class-variance-authority
```

Use these only if they improve readability. Do not add abstraction libraries by default if plain template strings are enough.

### 5.2 PostCSS

Add `apps/web-ui/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

### 5.3 CSS entrypoint

Update `apps/web-ui/src/app/globals.css` to include Tailwind v4 while preserving token and primitive imports.

Preferred structure:

```css
@import "@nexu-design/tokens/styles.css";
@import "@nexu-design/ui-web/styles.css";
@import "tailwindcss";

@theme inline {
  /* Map Tailwind theme entries to @nexu-design CSS variables. */
}

@layer base {
  :root {
    /* app layout variables */
  }

  html[data-theme="light"] {
    color-scheme: light;
  }

  html[data-theme="dark"] {
    color-scheme: dark;
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
  }
}
```

Ordering must be verified visually. If `@nexu-design/ui-web/styles.css` expects to define utilities or component classes after Tailwind base, adjust ordering deliberately and document the reason in the file header.

### 5.4 Theme mapping

Tailwind should expose semantic utilities backed by CSS variables.

Required mappings:

- colors:
  - `surface-0` → `var(--color-surface-0)`
  - `surface-1` → `var(--color-surface-1)`
  - `surface-2` → `var(--color-surface-2)`
  - `text-primary` → `var(--color-text-primary)`
  - `text-secondary` → `var(--color-text-secondary)`
  - `text-tertiary` → `var(--color-text-tertiary)`
  - `text-heading` → `var(--color-text-heading)`
  - `border` / `border-subtle` / `border-strong` / `border-hover`
  - `accent` → `hsl(var(--accent))`
  - `accent-foreground` → `hsl(var(--accent-foreground))`
  - success/warning/error/destructive aliases where used
- fonts:
  - `sans` → `var(--font-sans)`
  - `heading` → `var(--font-heading)`
  - `mono` → `var(--font-mono)`
- radii:
  - `sm`, `md`, `lg`, `xl`, `2xl` mapped to token variables
- shadows:
  - `xs`, `sm`, `md`, `dropdown`, `focus` mapped to token variables
- spacing:
  - Tailwind’s spacing scale should continue to correspond to `calc(var(--spacing) * n)`.

Prefer semantic aliases where readability is good:

```tsx
className="rounded-xl border border-border-subtle bg-surface-1 shadow-xs"
```

Use arbitrary values only when the value is genuinely app-specific:

```tsx
className="max-w-[var(--app-content-max-width)] px-[var(--app-page-padding-x)]"
```

## 6. Big-Bang Migration Scope

### 6.1 Files to inspect and migrate

Migrate all TSX files under:

```text
apps/web-ui/src/app/**/*.{ts,tsx}
apps/web-ui/src/components/**/*.{ts,tsx}
apps/web-ui/src/features/**/*.{ts,tsx}
```

Exact directories may vary, but the migration should cover every reference to classes currently defined in `globals.css`.

### 6.2 CSS class families to eliminate

Eliminate or drastically reduce the following app-authored class families:

```text
.shell
.sidebar-*
.main-canvas
.canvas-*
.page-intro
.welcome-*
.conversation-header-*
.composer-*
.chat-*
.message-text
.reasoning-block
.attachment-card
.source-card
.tool-card
.unknown-part-card
.stack
.stack-tight
.muted
.eyebrow
.grid
.card
.card-muted
.hero
.pill-*
.split
.session-*
.settings-*
.kv-*
.status-*
```

Some names may survive only if they are needed for non-React generated content or an external primitive slot override.

### 6.3 Suggested migration order inside the big-bang branch

Even though this is one big migration, implement it in controlled internal passes:

1. **Setup pass**
   - Add Tailwind/PostCSS.
   - Add theme mappings.
   - Keep existing CSS temporarily.
   - Verify build still works.

2. **Shared helper pass**
   - Replace `.stack`, `.stack-tight`, `.muted`, `.eyebrow`, `.grid`, `.card`, `.card-muted`, `.hero`, `.pill`, `.split`.
   - Extract components if useful.

3. **Welcome/home pass**
   - Convert `.welcome-*` styles.
   - Preserve hero layout, composer card, recent cards, responsive behavior.

4. **Shell/sidebar pass**
   - Convert `.shell`, `.sidebar-*`, `.main-canvas`, `.canvas-*`.
   - Preserve desktop shell behavior and `data-desktop-shell="true"` drag region logic.

5. **Conversation/composer pass**
   - Convert `.conversation-header-*`, `.composer-*`, `.chat-thread-*`, `.chat-message-*`.
   - Preserve message role styling and sticky jump button.

6. **Tool/message content pass**
   - Convert `.attachment-card`, `.source-card`, `.tool-card`, `.unknown-part-card` where markup is controlled.
   - Keep residual CSS for rendered `pre`, `code`, or markdown-like content only if required.

7. **Sessions pass**
   - Convert `.session-browser-*`, `.session-detail-*`, `.session-action-*`.

8. **Settings pass**
   - Convert `.settings-*`, `.kv-inline-action`, provider/model/directory/theme layouts.
   - Preserve tabs, active states, responsive provider grid, secret input focus state.

9. **Residual CSS cleanup pass**
   - Delete all now-unused class rules from `globals.css`.
   - Keep only the approved residual global layer.

10. **Verification pass**
   - Run typecheck/build.
   - Run visual smoke tests manually or with browser automation.
   - Search for stale class names.

## 7. Conversion Rules

### 7.1 Token usage

Allowed:

```tsx
className="bg-surface-1 text-text-primary border-border-subtle rounded-xl shadow-xs"
```

Allowed for app variables:

```tsx
className="max-w-[var(--app-content-max-width)] px-[var(--app-page-padding-x)]"
```

Avoid:

```tsx
className="bg-white text-slate-900 border-gray-200 rounded-lg shadow-sm"
```

Hard-coded colors are allowed only for intentionally illustrative previews such as the existing theme swatches, and even there prefer token-backed values if practical.

### 7.2 Responsive behavior

Use Tailwind variants for component-specific responsive behavior:

```tsx
className="grid grid-cols-1 min-[961px]:grid-cols-[var(--app-shell-width)_minmax(0,1fr)]"
```

Keep root-level variable changes in CSS when a single variable controls many descendants:

```css
@media (max-width: 640px) {
  :root {
    --app-page-padding-x: calc(var(--spacing) * 4);
  }
}
```

### 7.3 Data attributes

Use Tailwind data variants for state:

```tsx
className="data-[active=true]:bg-surface-2 data-[active=true]:text-text-heading"
```

For parent-driven state, use `group` and group data variants:

```tsx
<div data-desktop-shell={isDesktopShell} className="group/shell ...">
  <aside className="group-data-[desktop-shell=true]/shell:pt-3 ..." />
</div>
```

### 7.4 Pseudo-classes

Convert hover/focus/focus-within states to utilities:

```tsx
className="transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus"
```

### 7.5 Child/descendant selectors

Prefer adding classes directly to children. Use arbitrary variants only when direct control would make markup worse:

```tsx
className="[&_kbd]:rounded-sm [&_kbd]:border [&_kbd]:border-border-subtle"
```

Use this sparingly. If descendant styling becomes complex, extract a component.

### 7.6 `@apply`

Avoid `@apply` for app component styling.

Do not replace:

```css
.sidebar-nav-link { ... }
```

with:

```css
.sidebar-nav-link { @apply ...; }
```

That preserves the same global class architecture. If a style needs a name, create a React component or variant helper.

Acceptable `@apply` usage is limited to tiny global base patterns that cannot reasonably live in JSX.

## 8. Residual `globals.css` Contract

Establish this contract before migrating component slices so reviewers can tell
the difference between temporary coexistence CSS and approved long-term globals.
Feature CSS must stay in place until the owning slice is migrated and verified;
do not delete broad blocks early just because the final contract is smaller.

Approved final residuals are limited to:

- token, `@nexu-design/ui-web`, and Tailwind imports
- Tailwind theme, custom variant, and token alias declarations
- `:root` app variables such as shell widths, content widths, page padding,
  section gaps, and app surface aliases
- `html[data-theme="light"]` / `html[data-theme="dark"]` theme switching and
  theme-scoped app variable overrides
- base element styles for `html`, `body`, anchors, and form controls where they
  intentionally overlap with Tailwind Preflight
- accessibility or utility globals that are used outside React-controlled markup,
  such as `.sr-only` and `.mono`
- media queries that only adjust global app variables such as page padding
- keyframes and unavoidable animation primitives
- rendered rich-text/prose/pre/code rules where descendants are generated or not
  practical to decorate with direct Tailwind utilities
- unavoidable `@nexu-design/ui-web` slot overrides, documented by selector, when
  the primitive API does not expose a className/prop hook for the rendered slot

Not approved as final residuals:

- app-authored page or component class families (`shell`, `sidebar`, `welcome-*`,
  `conversation-*`, `composer-*`, `chat-*`, `session-*`, `settings-*`)
- generic helper classes (`stack`, `stack-tight`, `grid`, `split`, `card`,
  `card-muted`, `hero`, `pill`, `badge`, `status-*`, list helpers)
- global descendant selectors for React-controlled markup that can receive direct
  Tailwind classes or move into a small React component
- new `@apply` recreations of old global helpers

During slice migration, remove only the CSS blocks whose TSX references were
converted in that slice, then verify no stale references remain for those exact
legacy class names.

After migration, `globals.css` should be limited to roughly this shape:

```css
@import "@nexu-design/tokens/styles.css";
@import "@nexu-design/ui-web/styles.css";
@import "tailwindcss";

@theme inline {
  /* token mappings */
}

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

  html[data-theme="light"] {
    color-scheme: light;
  }

  html[data-theme="dark"] {
    color-scheme: dark;
    --app-canvas-bg: var(--color-dark-bg);
    --app-sidebar-bg: var(--color-surface-1);
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

@layer utilities {
  .mono {
    font-family: var(--font-mono);
  }
}

@keyframes monet-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (max-width: 640px) {
  :root {
    --app-page-padding-x: calc(var(--spacing) * 4);
  }
}
```

The exact final file can differ, but any remaining component-like class should be justified during review.

## 9. Implementation Checklist

### 9.1 Setup

- [ ] Add `tailwindcss` and `@tailwindcss/postcss` to `apps/web-ui` dev dependencies.
- [ ] Add `apps/web-ui/postcss.config.mjs`.
- [ ] Add Tailwind v4 import/directives to `globals.css`.
- [ ] Add token-backed `@theme inline` mappings.
- [ ] Verify `pnpm --filter @monet/web-ui build` still succeeds before JSX migration.

### 9.2 Component migration

- [ ] Convert shell/sidebar/main canvas classes.
- [ ] Convert welcome/home classes.
- [ ] Convert composer classes.
- [ ] Convert conversation header classes.
- [ ] Convert chat thread and message card classes.
- [ ] Convert tool/source/attachment cards.
- [ ] Convert shared helper classes.
- [ ] Convert session browser/detail classes.
- [ ] Convert settings page/provider/model/directory/theme classes.
- [ ] Replace generic `.card`, `.grid`, `.hero`, `.stack`, `.muted`, `.eyebrow` usage.

### 9.3 Cleanup

- [ ] Delete obsolete CSS blocks from `globals.css`.
- [ ] Search for stale class references from removed CSS.
- [ ] Search for CSS rules that no longer match any markup.
- [ ] Keep only approved residual global CSS.
- [ ] Document any intentionally retained global selector.

### 9.4 Validation

- [ ] Run `pnpm --filter @monet/web-ui typecheck`.
- [ ] Run `pnpm --filter @monet/web-ui build`.
- [ ] Run root `pnpm typecheck` if migration touched shared types or package scripts.
- [ ] Run root `pnpm build` before merge if feasible.
- [ ] Smoke test web UI in development mode.
- [ ] Smoke test desktop renderer if Electron depends on the generated static output.

## 10. Visual QA Checklist

Verify at minimum:

1. App shell
   - desktop two-column layout
   - mobile single-column layout
   - sidebar scroll behavior
   - desktop drag region behavior

2. Home/welcome
   - hero spacing
   - large composer card
   - recent cards
   - responsive card grid

3. Conversation
   - header layout
   - target picker
   - active composer
   - user vs assistant message cards
   - tool call states: awaiting confirmation, running, completed, failed
   - sticky jump-to-bottom button

4. Sessions
   - list/detail split layout
   - active session state
   - responsive collapse

5. Settings
   - tab header
   - provider grid
   - model list
   - secret input focus/disabled state
   - directory list truncation
   - theme selection cards

6. Themes
   - light theme
   - dark theme
   - system theme if supported

7. Breakpoints
   - `> 960px`
   - `<= 960px`
   - `<= 640px`

## 11. Review Criteria

The migration is acceptable when:

1. `globals.css` no longer contains large page/component sections.
2. Tailwind classes use token-backed semantic values.
3. There are no avoidable hard-coded colors, radii, shadows, or font families.
4. Removed global class names are not referenced in TSX.
5. The app builds and typechecks.
6. The main screens visually match the pre-migration design closely.
7. Any residual global selectors are explicitly global, prose-related, animation-related, theme-related, or primitive slot overrides.

## 12. Risks and Mitigations

### 12.1 Tailwind preflight changes base rendering

Mitigation:

- Compare base element styles after setup.
- Keep explicit app base styles in `@layer base`.
- If necessary, disable or neutralize specific preflight effects rather than silently accepting visual drift.

### 12.2 Token mapping mismatch with `@nexu-design/ui-web`

Mitigation:

- Map Tailwind values directly to CSS variables from `@nexu-design/tokens`.
- Avoid duplicating numeric values in Tailwind config/CSS.
- Prefer a future shared Tailwind preset from `@nexu-design/tokens` if the package provides one later.

### 12.3 JSX readability degrades

Mitigation:

- Extract components for repeated patterns.
- Use small `cn()` helpers if class composition becomes conditional.
- Avoid extreme arbitrary variants where direct child classes or components would be clearer.

### 12.4 Visual regressions from selector rewrites

Mitigation:

- Convert state selectors to direct `data-*` variants.
- Use screenshots/manual QA for all key screens.
- Keep migration in a single focused branch but implement internally by screen area.

### 12.5 Residual global CSS creeps back

Mitigation:

- Add a review rule: no new app component sections in `globals.css`.
- If new styling must be reused, create a component or variant helper.

## 13. Suggested Work Breakdown

Although the final delivery should be a single big-bang migration, the work can be split among implementers:

1. **Foundation owner**
   - Tailwind/PostCSS setup
   - theme mapping
   - residual global CSS contract

2. **Shell/home owner**
   - app shell
   - sidebar
   - main canvas
   - welcome page

3. **Conversation owner**
   - conversation header
   - composer
   - chat thread
   - tool/source/attachment cards

4. **Settings/sessions owner**
   - settings tabs and forms
   - provider/model/directory/theme screens
   - session browser/detail pages

5. **QA owner**
   - stale class search
   - typecheck/build
   - visual smoke checklist

All owners should coordinate on the same token utility names before converting JSX to avoid inconsistent class vocabulary.

## 14. Commands

Useful commands during implementation:

```bash
pnpm --filter @monet/web-ui add -D tailwindcss @tailwindcss/postcss
pnpm --filter @monet/web-ui typecheck
pnpm --filter @monet/web-ui build
pnpm typecheck
pnpm build
```

Stale class search examples:

```bash
rg "className=|class=|\.welcome-|\.settings-|\.sidebar-|\.composer-|\.chat-" apps/web-ui/src
rg "welcome-|settings-|sidebar-|composer-|chat-|session-" apps/web-ui/src
```

## 15. Open Questions

1. Should `@nexu-design/tokens` eventually export a first-party Tailwind v4 theme preset?
2. Should the app standardize on a `cn()` helper and `class-variance-authority`, or keep plain class strings until variants become complex?
3. Should primitive slot overrides be moved upstream into `@nexu-design/ui-web` after this migration?
4. Should visual regression screenshots be introduced now, or is manual visual QA enough for the initial big-bang migration?

## 16. Final Recommendation

Proceed with the big-bang Tailwind v4 adoption now.

The project is early enough that the migration cost is acceptable, and delaying will make the current global stylesheet harder to unwind. The important constraint is that Tailwind must be a token-backed authoring layer over `@nexu-design/tokens`, not a new design system.

After this migration, `globals.css` should be a small foundation file, and app screens should be styled primarily through Tailwind utilities and reusable React components.
