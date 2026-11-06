# Tasks

## 1. API

- [x] 1.1 Add `before=<seq>` to `GET /api/sessions/:id/events` (D5) and a `node --test` case: with 500 events, `limit=200&before=<seq>` returns the 200 entries before it, newest last, and the default call still returns the newest 200.

## 2. AI Elements

- [x] 2.1 Add `components.json` (Radix, Tailwind v4, aliases) and install `message`, `tool`, `trace`, `chat`, `message-scroller`, `code-block` with the shadcn CLI, Radix variant; add `streamdown` and any Radix primitives they pull in to `package.json` with pinned versions (D4). Verify `npm run typecheck` and `npm run build` pass with the copied files and that the runtime image build still succeeds.
- [x] 2.2 Build `Conversation.tsx` (D4, D5): event-to-component mapping, tool grouping into one `Trace`, waiting state, live merge by `seq` on the SSE signal, "frühere Einträge" with preserved scroll position, empty state. Verify against the seed: janus shows the prompt bubble, the two tool lines with one in "Freigabe ausstehend", and the reply as Markdown; posting a new reply through the seed appears within a second without reload.

## 3. Detail view

- [x] 3.1 Extract `CardBody` from `BoxCard.tsx` and build `DetailView` with the two-column and the stacked layout (D3); hash routing, close by button, Escape and back, deep link on load, `inert` grid underneath (D1). Verify in the browser: tap opens with `#<box>`, back closes, `/#looptalk` opens directly, 1280 px shows two columns without page scroll, 390 px stacks with no horizontal overflow.
- [x] 3.2 Add the view transition (D2) with the reduced-motion rule, and remove the collapsible timeline from the card, adding the "Öffnen" control and the clickable card (D6). Verify with Playwright that card heights stay uniform (304 px at 390 px as measured before), that `document.startViewTransition` is called on open in Chromium, and that the view opens without error with the API stubbed out.

## 4. Documentation and check

- [x] 4.1 README: a paragraph on the detail view (tap, back, link to a box) in "Status dashboard"; design.md gets the measured bundle size before and after Streamdown. Verify `npm test`, `npm run typecheck`, `npm run build` and the dashboard Docker build pass.
