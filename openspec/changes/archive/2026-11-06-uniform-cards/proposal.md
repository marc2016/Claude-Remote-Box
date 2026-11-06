# Proposal

## Why

Cards differ in height depending on state: a waiting session adds an alert, a box in setup has an alert but no session block, a session without git data lacks a line. On the phone, where cards stack, every difference shows, and the eye has to search for the same information in a different place on each card. The user wants every card the same height, with one status box per card that is green while Claude works.

## What Changes

- Every card gets a status box below the mascot strip, always two lines high, colored by state: green "Arbeitet" with the last action, amber "Wartet auf dich" with the waiting tool and elapsed time, grey "Idle seit …", "Session beendet", "Offline seit …" and "Noch keine Session", amber "Setup fehlt" with the `setup` command (or the config hint), red "Startet neu". The box replaces today's waiting alert, setup alert, and the activity text in the strip.
- The mascot strip keeps Clawd alone, across the full card width.
- The session block is always rendered with the same four rows: age and model, context bar, totals, git line; rows without data show a dash. The footer is always present; without a session the session-id button and the timeline toggle are disabled.
- Result: all cards have the same height at a given width.

Out of scope: tables, compact mode, per-card settings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `status-dashboard`: requirements "Cards" and "Mascot on the card" change to the status box, the fixed rows, and the mascot-only strip.

## Impact

- `dashboard/web/src/components/BoxCard.tsx` (status box, fixed rows, footer), `index.css` (box colors), `seed.mjs` unchanged. Height check with the existing Playwright scripts.
