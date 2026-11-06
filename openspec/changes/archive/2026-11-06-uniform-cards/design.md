# Design

## Context

See proposal.md. `BoxCard.tsx` today: header, `Stage` (Clawd plus text), optional waiting alert, optional setup alert, optional `SessionBlock` with a variable number of rows, footer only with a session. The card model already has everything the status box needs: `state`, `waiting_since`, `waiting_text`, `last_activity`, `ended_at`, `last_heartbeat`, `phase`; the last tool call is not in the card model yet.

## Decisions

### D1: Status box as one component with a fixed two-line body
`StatusBox` renders a `div` with `min-h` for two lines (title row plus detail row), `role="status"`, background and border from a variant: `success`, `warning`, `muted`, `destructive`. The detail row always exists; when there is nothing to say it holds a non-breaking space so the height stays. Variants by state:

```
box down                 muted      Offline seit <dauer>      | letzter Heartbeat <zeit>
phase restarting         destructive Startet neu              | letzte Phase <phase>
phase waiting-setup      warning    Setup fehlt               | docker compose exec -it <name> setup
phase waiting-config     warning    Config-Ordner             | docker compose logs <name>
no session               muted      Noch keine Session        | (leer)
session ended            muted      Session beendet           | <zeit>
session waiting          warning    Wartet auf dich · <dauer> | <tool>: <summary>
session working          success    Arbeitet                  | <last tool>: <summary>
session idle             muted      Idle seit <dauer>         | <last tool>: <summary>
```

### D2: Last tool call in the card model
`sessions` gets `last_tool` and `last_tool_summary`, set by the `tool` event in `db.js` (`applySession`), exposed in `SessionCard` as `last_tool: string | null`. One column, one line in `cards.js`, one field in `types.ts`. The migration is `ALTER TABLE ... ADD COLUMN` guarded by a check of `PRAGMA table_info`, so an existing dashboard database keeps working.

### D3: Fixed session rows
`SessionBlock` always renders four rows; each row takes `s: SessionCard | null` and prints an en dash in `text-muted-foreground` when its data is missing. The context bar shows an empty track for a missing session. The git row is always present (today it is conditional). The totals row no longer wraps: `+212 / -37` moves into the git row's right end, so no row can grow to two lines on a 390 px screen.

### D4: Footer always present
The session-id button and the timeline toggle render for every card; without a session both are `disabled`. The `Collapsible` stays mounted so the toggle's height is constant.

### D5: Strip is mascot only
`Stage` loses its text; the track spans the card's content width. The walk keyframe already uses `calc(100% - 32px)`, so Clawd covers the full width.

### D6: Colors
`success` variant: `bg-success/15 border-success/60` with the title in `text-success` (dark) or a darker green on light (`oklch(0.45 0.15 150)` as `--success-foreground`, added to the theme). `warning` as the existing alert, `muted` as `bg-muted`, `destructive` as `bg-destructive/15 border-destructive/60`.

## Risks / Trade-offs

- [Setup cards carry four empty rows] → accepted; they are temporary and the user asked for uniform heights.
- [A long tool summary wraps the detail row] → `truncate` on the detail row; the full text stays in the timeline.
- [Older dashboard database without `last_tool`] → the guarded `ALTER TABLE` adds the column on start.

## Migration Plan

Web app and a backward-compatible schema addition; ships with the next dashboard image.

## Measurements

Playwright against the seed (working, waiting, ended, waiting-setup): every card is 304 px high at 390 px width and at 1280 px, light and dark, with and without reduced motion; no horizontal overflow. Before this change the same cards measured 232, 326, 232 and 186 px. The status box is 60 px (two lines of 20 px plus padding), the mascot strip 24 px, the session block four rows of 16 px with 6 px gaps. Server tests 11/11 including the `last_tool` migration on an old-schema database file.

