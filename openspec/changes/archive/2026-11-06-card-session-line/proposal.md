# Proposal

## Why

The session line on a card shows the session's first prompt as a heading. After the second turn that text says nothing about the session any more, and the expanded timeline shows the prompt anyway. What a glance at the phone wants to know instead is how long the session has been running and whether it is still alive.

## What Changes

- The session line keeps the model on the right and replaces the first-prompt label on the left with the session age ("seit 2 h") and, when the last activity was not today, its time ("zuletzt 05.11. 23:10"). The first prompt stays available in the timeline and as the hover title of the line.
- Nothing else on the card moves; the line stays one row high.

Out of scope: session names from the Claude app (`slug`, `ai-title`), which depend on the transcript check in `box-status-reporting`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `status-dashboard`: the "Cards" requirement names the session age instead of the label.

## Impact

- `dashboard/web/src/components/BoxCard.tsx` (session line) and `dashboard/web/src/lib/utils.ts` if a date helper is needed. No server or API change; `started` and `last_activity` are already in the card model.
