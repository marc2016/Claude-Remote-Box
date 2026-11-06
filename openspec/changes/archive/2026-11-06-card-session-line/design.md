# Design

## Context

See proposal.md. `SessionCard` already carries `started`, `last_activity`, and `label`; the card recomputes elapsed times every 5 s from `now`. `fmtDuration` and `fmtTime` exist in `web/src/lib/utils.ts`; `fmtTime` already switches to a day-and-time format when the date is not today.

## Decisions

### D1: Age from `started`, "zuletzt" only when not today
Left text: `seit ${fmtDuration(now - started)}`; when `last_activity` is on another day, append ` · zuletzt ${fmtTime(last_activity)}`. Sessions without `started` (summary never arrived) show nothing on the left. The `title` attribute keeps the first prompt, so a long press on the phone still reveals it.
- *Alternative: always show "zuletzt".* Rejected: for a live session the stage already says "arbeitet" or "idle seit …", and the line would repeat it.

### D2: No layout change
Same flex row, same text sizes; the left span is `text-muted-foreground`, the model stays on the right. The screenshot check from `card-mascot` is reused to confirm the card height is unchanged.

## Risks / Trade-offs

- [`started` missing on old sessions] → left side empty, card still valid.

## Measurements

Playwright at 390 px against the seed: the working card went from 236 to 232 px and the waiting card from 330 to 326 px (the line is now `text-xs` on both sides), no horizontal overflow. The session lines read "seit …" with the model on the right; the `archiv` card, seeded with timestamps from the day before, adds "zuletzt" with day and time. The first prompt is the line's `title` only. The seed's `archiv` events were moved to yesterday's timestamps so the demo shows that case.

