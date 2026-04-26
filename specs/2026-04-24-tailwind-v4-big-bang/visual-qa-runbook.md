# Tailwind v4 visual QA runbook

This runbook makes the final visual QA task executable after the Tailwind v4 migration. It favors real app routes and manual state setup over permanent QA-only fixtures.

## Prerequisites

1. Start the controller and web UI with the normal dev stack:

   ```bash
   pnpm dev
   ```

   If running only the web UI, point it at a controller:

   ```bash
   VITE_MONET_CONTROLLER_URL=http://127.0.0.1:42831 \
   VITE_MONET_CONTROLLER_BEARER_TOKEN=monet-dev-token \
   pnpm --filter @monet/web-ui dev
   ```

2. Open `http://127.0.0.1:42832`.
3. Keep browser devtools available for viewport resizing and theme inspection.
4. Run the route matrix in all required viewport widths:
   - desktop: `1280x900` or wider (`> 960px`)
   - app collapse: `960x900` and `800x900` (`<= 960px`)
   - phone: `390x844` or `640x900` (`<= 640px`)
5. Run at least one pass in each theme mode from `/settings/general`: Light, Dark, and System. For System, verify once with the OS/browser set to light and once set to dark if feasible.

## State setup checklist

Use these setup steps before the final QA pass.

### Provider and model states

- **No ready provider / setup required:** temporarily run without provider API keys or use a fresh local data directory. Verify redirects to `/settings/models`, the sidebar primary button says `Finish model setup`, and composer controls are disabled with setup copy.
- **Ready provider:** configure at least one OpenAI or OpenRouter key, then visit `/settings/models` and validate the provider. Verify a ready badge, enabled model count, provider detail, and model list.
- **Validation failure:** enter an intentionally invalid secret or base URL, click validate, and verify destructive/error badges and guidance copy.
- **Provider/model loading and empty states:** reload `/settings/models` while the controller is starting for loading copy; if no providers are present, verify the `No providers configured yet` empty card.

### Sessions and conversation data

- Create at least two active sessions from `+ New chat` or the welcome composer.
- Rename one session from `/sessions` so long titles and metadata wrapping are visible.
- Archive one session from `/sessions` to verify archived state copy and disabled/alternate chat behavior.
- Leave one route with no selected session by visiting `/sessions` without a `?session=` query to verify the selected-session empty state.
- Keep one blank current session with no messages to verify the chat empty card.
- Keep one session with user and assistant messages to verify alignment, message widths, badges, and pre-wrap text.

### Tool phase states

Use a tool-capable model and an authorized directory in `/settings/general`.

1. In chat, ask for a small file write inside the authorized directory. Verify the `awaiting-confirm` card before approving.
2. Click Approve and verify the temporary submitted/pending state if visible.
3. During execution, verify `preparing` / `running` tool cards when they appear.
4. After completion, verify the `completed` card, target path block, content preview, output block, and code/pre overflow.
5. Repeat with a disallowed or invalid path to verify the `failed` card and error block.
6. If the live model/tool path cannot deterministically produce all phases, record that limitation and use the persisted session with the most complete phase coverage for the final QA screenshots.

## Route and state matrix

| Route | Required states to inspect | Visual details to verify |
| --- | --- | --- |
| `/` with no `?session=` | Welcome home, provider setup required, provider ready, recent sessions present, recent sessions empty | Shell/sidebar, hero spacing, welcome badge tone, large composer card, textarea placeholder/disabled state, keyboard hints, info card grid, recent cards, hover elevation |
| `/?session=<blank-session-id>` | Empty chat thread and active composer | Conversation header, target picker, empty chat card, composer focus-within border/shadow, sidebar active recent item |
| `/?session=<message-session-id>` | User/assistant messages, streaming if possible, transport error if possible | User card alignment/accent background, assistant card width, metadata badges, message text pre-wrap, sticky `Back to bottom` button after scrolling up |
| `/?session=<tool-session-id>` | Tool phases: awaiting confirm, preparing/running, completed, failed; reasoning/source/file/unknown parts when available | Tool card tone per phase, approval buttons, path/code overflow, pre/code readability, attachment/source cards, details/summary styling |
| `/sessions` | Loading, empty selected detail, active selected session, archived session, sessions error if available | Browser/detail split, item hover/active states, action button wrapping, message preview cards, responsive single-column collapse |
| `/settings/general` | Directory list empty/populated, directory add/remove feedback, browser vs desktop app paths, theme choices light/dark/system | Settings header/tabs, authorized directory truncation, inline action buttons, theme option active/focus states, swatches, responsive theme grid |
| `/settings/models` | Providers loading, no providers, selected provider, validation ready/failure, missing credentials, model list empty/populated | Provider/model split grid, active provider card, badges/status dots, secret input focus/disabled states, validation card, callouts, model metadata wrapping |

## Breakpoint-specific checks

For each route above, verify:

- **`> 960px`:** app shell is two columns, sidebar is sticky/full-height, main canvas scrolls independently, content width stays capped, desktop drag-region spacer appears inside desktop shell.
- **`<= 960px`:** shell collapses to one column, sidebar becomes top content with bottom border, canvas/header/body/composer rows do not overflow horizontally, session and settings grids collapse to one column.
- **`<= 640px`:** page padding tightens, settings header/tabs remain usable, composer footer/action rows wrap, directory rows and message/tool pre blocks do not force horizontal page scroll.

## Theme checks

Run at least these theme assertions:

- Light: surface cards, sidebar, canvas, border, accent, success/warning/error/destructive states use token-backed colors and retain contrast.
- Dark: `html[data-theme="dark"]` applies without requiring a `.dark` class; canvas/sidebar surfaces, text, focus rings, and tool phase backgrounds remain legible.
- System: theme choice card reflects `System`; changing OS/browser preferred color scheme updates the resolved theme after reload or provider effect runs.

## Pass/fail notes for final QA

During final QA, record:

- route URL and viewport size
- theme mode and resolved theme
- state covered, especially whether all tool phases were available
- any visual drift from the pre-migration design
- any horizontal overflow, clipping, unreadable contrast, missing focus ring, or primitive slot regression

The Tailwind migration visual QA is complete only when every row in the route matrix has been checked at the three breakpoint bands and at least light/dark themes.
