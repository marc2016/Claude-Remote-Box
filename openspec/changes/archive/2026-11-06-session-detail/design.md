# Design

## Context

See proposal.md. Today `BoxCard.tsx` renders a Radix `Collapsible` with a `Timeline` that fetches `/api/sessions/:id/events` on open and every 10 s. `App.tsx` holds the SSE subscription and refetches `/api/boxes` on `changed`. shadcn components are hand-written in `components/ui/` (Radix primitives, `cva`, `cn`); there is no `components.json`. shadcn AI Elements (ui.shadcn.com/docs/ai-elements) are copied into a project with the shadcn CLI, exist in Base UI, React Aria and Radix variants, render replies with Streamdown, and need no AI SDK: `Message`, `Bubble`, `Tool`, `Trace`, `Chat`, `Message Scroller` take plain props.

## Goals / Non-Goals

**Goals:** one tap to a full conversation that reads like a chat; live; back-button friendly; no regression in card uniformity.

**Non-Goals:** composing messages, reasoning display, tool output bodies, multi-session views per box (the active session only; others stay reachable later).

## Decisions

### D1: Detail view as a modal over the grid, addressed by the hash
`App.tsx` reads `location.hash`; `#<box>` selects the detail view. Open: `history.pushState`; close: `history.back()` when the previous entry is ours, else `replaceState('')`. Escape and the close button call the same close. The view is a modal: a dimmed, blurred backdrop over the grid (a tap on it closes), and a centered dialog panel, full-size minus a small margin on the phone and at most 92 % of the viewport height on larger screens. The grid stays mounted underneath (so the SSE state and scroll position survive) and gets `inert` while the view is open.
- *Alternative: a Radix Dialog.* Rejected: a dialog cannot be the target of the view transition from the card, and the back gesture on the phone would close the page instead of the dialog.

### D2: Animation with the View Transitions API
The card root and the whole dialog panel share `view-transition-name: box-<name>`, so the card visibly grows into the dialog and shrinks back (0.35 s, ease-out). While the dialog is open the grid card drops its name (`opened` prop): two live elements with the same `view-transition-name` make the browser skip the transition silently, which is exactly what happened in the first build and only showed up when `document.getAnimations()` listed no `::view-transition-group(box-*)`. Two more things keep the animation clean: only the card taking part in the current transition carries a name (`animBox` in `App.tsx`), because every named element is lifted onto its own layer above the root snapshot and would otherwise appear undimmed over the backdrop and jump at the end; and the transition is typed (`startViewTransition({ update, types: ['open' | 'close'] })`, callback fallback for older browsers) so the CSS can treat the two directions differently: on open the old card snapshot is hidden and the new dialog snapshot is shown at natural size (`object-fit: none`, top-left) inside the growing, clipped group, a window onto the dialog instead of a stretched crossfade; on close the dialog snapshot stays at natural size while the group shrinks and the card fades in at the end. Elements use `view-transition-class: box` so the rules need no per-box names; opening and closing run inside `document.startViewTransition(() => flushSync(setOpen(...)))`. Browsers without it (`!document.startViewTransition`) call the callback directly. `prefers-reduced-motion` sets the transition duration to 0 through the `::view-transition-group` rule.
- *Alternative: framer-motion `layoutId`.* Rejected: 30 kB for one effect, and the native API covers the user's devices.

### D3: Layout
`DetailView`: a fixed, full-viewport container with `grid-cols-1 md:grid-cols-[minmax(280px,360px)_1fr]`; the left column reuses the card's sections (`CardHeader`, Clawd strip, `StatusBox`, `SessionBlock`, session link) through a shared `CardBody` component so card and view cannot drift apart; the right column is the conversation with its own scroll container (`min-h-0`). Below `md` the left column becomes a compact block (header, status box, one row of numbers) and the conversation takes `flex-1`.

### D4: Conversation from AI Elements, Radix variant, installed by the CLI
Add `components.json` (style "new-york", Radix, Tailwind v4, aliases matching `vite.config.ts`), then `npx shadcn@latest add message tool trace chat message-scroller code-block` with the Radix registry variant. The files land in `components/ui/` and `components/ai/` and are committed. If the CLI cannot run non-interactively, the files are copied by hand from the docs; either way they are ours afterwards. `Conversation.tsx` maps our events:

```
prompt            -> <Message align="user"><Bubble>text</Bubble></Message>
reply             -> <Message align="agent"><Streamdown>{text}</Streamdown></Message>
tool              -> <Tool state="input-available" title="Bash: npm test" />
  + tool_result   -> state "output-available" or "output-error"
  + waiting       -> state "approval-requested" (label "Freigabe ausstehend")
  + resumed       -> back to "input-available"
```
Consecutive tool lines between two messages render inside one `Trace` group so a burst of 40 calls stays compact.
- Streamdown is the markdown engine the components expect; it is the largest dependency this adds (around 100 kB gzipped with its remark stack). Accepted for a LAN dashboard; a lighter renderer could replace it later behind the same `Message` component.

### D5: Live updates and pagination
`Conversation` subscribes to the existing SSE `changed` signal: when the box's name is in the payload, it fetches the default page (`limit=200`, newest entries) and merges it into the in-memory list by `seq`, so already-known entries are skipped and only new ones are appended. The API gains only `before`; an `after` parameter is not needed for this merge. Older entries: "frühere Einträge" at the top calls `before=<oldest seq>` and prepends; the scroll position is preserved by measuring `scrollHeight` before and after. `Message Scroller` handles stick-to-bottom and the "neue Einträge" pill.

### D6: Card changes
`BoxCard` loses `Collapsible`, `Timeline`, `TimelineItem`; the footer shows the session link and a ghost button "Öffnen" with a chevron-right; the whole card is clickable (`role="button"`, Enter/Space) except its buttons. Heights stay uniform because the footer keeps one row.

## Risks / Trade-offs

- [shadcn CLI needs network and may change registry paths] → the copied files are committed; the CLI runs once.
- [Streamdown renders untrusted Markdown from Claude's replies] → Streamdown sanitizes by default (no raw HTML); links open in a new tab with `rel="noreferrer"`.
- [View transition name collisions with many boxes] → names are per box name, unique by construction.
- [Hash routing collides with a future auth redirect] → the hash is read after load; an auth layer would use the path, not the hash.
- [Large sessions] → 200 per page, pagination by `seq`.

## Measurements

Bundle (Vite, gzip): before this change one chunk of 101 kB. After: the main chunk 100 kB and a lazily loaded `Conversation` chunk of 155 kB (Streamdown with its remark/rehype stack, the AI Elements, and `@shadcn/react`), fetched the first time a detail view opens. The shadcn CLI (4.23) installed `message`, `bubble`, `message-scroller`, `trace` from the `radix-nova` style; `tool` and `chat` are compositions in the docs, not registry items, so `Tool` is `Trace` lines with a status and `Chat` is the message scroller. The CLI replaced `button.tsx` and `collapsible.tsx` with the nova versions (`radix-ui` umbrella package, `cn` package), which changed button heights slightly; cards measure 300 px now, still uniform. `code-block` was left out: it pulls in `shiki`, and the boxes report no tool output text. Playwright: 17 checks pass (uniform cards, hash, `startViewTransition` called, two columns at 1280 px without page scroll, stacked at 390 px without overflow, prompt/tool/waiting/Markdown rendered, a reply posted while open appears within 3 s, Escape, close button, and deep link).

## Migration Plan

Web app and one API parameter; ships with the next dashboard image. No data change.
