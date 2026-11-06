# Proposal

## Why

The timeline lives in a collapsible strip at the bottom of a card: cramped, plain text, refreshed by polling, tool calls as grey one-liners. On the phone it is the thing the user opens most, to see what Claude is doing right now, and it deserves the whole screen. The user wants to tap a card and have it grow into a detail view, information on the left and the conversation on the right, built on shadcn's AI Elements so the conversation reads like a chat.

## What Changes

- Tapping a card opens a detail view for that box; the card animates into it (View Transitions API, no animation where unsupported). The view has a close button; Escape and the browser's back navigation close it too, because the open box is in the URL hash (`#<box>`), which also makes a box linkable.
- Layout: from 768 px up, the card's information (header, Clawd, status box, session rows, session link) stands on the left and the conversation on the right; below that, the information is a compact block on top and the conversation fills the rest of the screen.
- The conversation is built from shadcn AI Elements (Radix variant), copied into the project: `Chat` with `Message Scroller` (stays at the bottom while the user is at the bottom, otherwise offers "neue Einträge"), `Message` with `Bubble` for prompts, agent replies rendered as Markdown through Streamdown, `Tool`/`Trace` lines for tool calls with states running, done, error, and "Freigabe ausstehend" for a waiting session. It updates live from the SSE stream, no polling. Older entries load on demand at the top.
- The card loses its collapsible timeline and the "Verlauf" toggle; the footer keeps the session link and gets an "Öffnen" affordance. Card heights stay uniform.

Out of scope: sending messages (chat stays in the Claude app), reasoning/thinking display (the boxes do not report it), tool output text (the boxes report ok/error only).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `status-dashboard`: "Cards" loses the in-card timeline; a new requirement "Session detail view" covers the detail view, its layout, navigation, and the conversation; "Read API and live updates" gains pagination for the session events.

## Impact

- `dashboard/web/`: new `DetailView`, `Conversation` components, AI Elements files under `components/ai/`, `components.json` for the shadcn CLI, View Transitions CSS, hash routing in `App.tsx`; `BoxCard.tsx` loses the timeline.
- `dashboard/server/`: `GET /api/sessions/:id/events` gains `before=<seq>` for loading older entries.
- `package.json`: `streamdown` and the Radix primitives the copied components need.
- README: one paragraph on the detail view.
