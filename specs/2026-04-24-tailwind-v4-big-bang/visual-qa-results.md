# Tailwind v4 visual QA results

Date: 2026-04-24

## Setup

- Controller: `MONET_CONTROLLER_BEARER_TOKEN=monet-dev-token pnpm --filter @monet/controller dev`
- Renderer: static export from `pnpm --filter @monet/web-ui build`, served from `apps/web-ui/out` on `http://127.0.0.1:42832`
- Seeded QA sessions:
  - blank chat: `ses_dm6w3ygow0mov2jkfa37hkn8`
  - message/tool chat: `ses_vqa_message_tool`
  - archived session: `ses_eu6hadg89qardmvptldril1c`

## Coverage

- Routes checked: `/`, `/?session=ses_dm6w3ygow0mov2jkfa37hkn8`, `/?session=ses_vqa_message_tool`, `/sessions`, `/sessions?session=ses_vqa_message_tool`, `/settings/general`, `/settings/models`.
- Viewports checked: `1280x900`, `960x900`, `800x900`, `390x844`.
- Themes checked: Light, Dark, System with browser media set to light and dark.
- Tool phases present in the message/tool chat: `awaiting-confirm`, `preparing`, `running`, `completed`, `failed`.

## Result

- Pass: no horizontal document overflow was detected on the checked route/theme/viewport matrix.
- Pass: desktop shell stayed two-column above 960px; shell/sidebar/settings/session layouts collapsed to one column at 960px and below after adjusting the app breakpoint contract.
- Pass: light, dark, and system theme modes resolved via `html[data-theme]`; dark mode did not require a `.dark` selector for Tailwind variants.
- Pass: chat message cards, composer, session browser, settings provider/model/general states, long paths, pre/code blocks, and tool phase cards remained readable and contained.
