# Tasks

## 1. Data

- [x] 1.1 Add `last_tool` to the sessions table (guarded `ALTER TABLE`), set it on `tool` events, and expose `last_tool` in the card model and `types.ts` (D2). Verify with a `node --test` case: after a `tool` event the card's `last_tool` is "Bash: npm test"; opening a database created before the column exists adds it without error.

## 2. Card

- [x] 2.1 Build `StatusBox` (D1, D6) with the four variants and the state mapping, and the `--success-foreground` token. Verify with the seed: janus amber with "Wartet auf dich · …" and "Bash: npm test", looptalk green with "Arbeitet" and its last tool, flashagenda amber with the setup command, archiv grey with "Session beendet".
- [x] 2.2 Make the session block four fixed rows with dashes, move the +/- lines into the git row, keep the footer always present with disabled controls when there is no session, and remove the text from the mascot strip (D3, D4, D5). Verify in the browser that no row wraps at 390 px and that the strip holds only Clawd.
- [x] 2.3 Measure with Playwright at 390 px and 1280 px: all four demo cards have the same height, no horizontal overflow; `npm run typecheck`, `npm test`, and `npm run build` pass. Record the heights in design.md.
