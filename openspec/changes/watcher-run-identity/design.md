# Design

## Context

See proposal.md. Today: `crb-watch.js` keeps `seq` in `/tmp/crb-seq` and file offsets in memory; `db.js` has `events` with primary key `(box, seq)` and orders a session's events by `seq`; the web app keys and pages by `seq`.

## Decisions

### D1: Run id and state in the config directory
`$CLAUDE_CONFIG_DIR/.crb-watch.json` holds `{ run, seq, files: { "<path>": offset } }`. On start the watcher loads it; without it, it generates `run` (8 random hex) and starts `seq` at 0. The file is written every 5 s when dirty and on stop. Offsets let a restarted watcher continue exactly where it left off; the run id makes a container with a fresh config a new run for the dashboard.
- `--emit` (entrypoint phase events, one process per call) reads the same file for `run` but numbers its events from `/tmp/crb-emit-seq` and sends `run: "<run>.e"`, a separate namespace, so it never races the daemon on `seq`. A missing state file at emit time (first phase events before the watcher ever ran) creates it with a fresh run id.

### D2: Backfill rule
With a state file, every known transcript resumes from its offset; unknown ones are new sessions and go live. Without a state file, every transcript present at start is aggregated only (summary with `backfill: true`), regardless of age; live events begin with lines appended after start. This replaces the 24 h rule: a fresh state means either a fresh box or a reset config, and in both cases re-sending history would duplicate what the dashboard may already hold.

### D3: Dashboard key and order
`events` gets `run TEXT NOT NULL DEFAULT ''` and primary key `(box, run, seq)`; SQLite cannot change a primary key in place, so `openDb` rebuilds the table once (rename, create, copy with `run = ''`, drop) when the column is missing. Ordering and pagination use `rowid`, exposed as `id` on every event the API returns; `before=<id>` filters `rowid < ?`. The web app keys list items by `id` and merges live pages by `id`.

## Risks / Trade-offs

- [Config directory not writable for the state file] → the watcher logs once and falls back to in-memory state with a fresh run id each start; the dashboard then dedupes per run, so nothing is lost, only resumed less precisely.
- [Table rebuild on a large database] → one-time copy; the dashboard keeps 7 days of events, so the table is small.
- [Old boxes without `run`] → stored with run `''`, same behavior as before for them.

## Migration Plan

Box image and dashboard image both change; release both (one tag). A dashboard updated before the boxes keeps working (empty run); boxes updated before the dashboard would be deduplicated by the old key again until the dashboard follows, so update the dashboard first or both at once (`./crb update`).
