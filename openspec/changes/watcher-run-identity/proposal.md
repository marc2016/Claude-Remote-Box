# Proposal

## Why

After a box container is recreated, the dashboard stops seeing it. The watcher numbers its events and keeps the counter in `/tmp`, which a new container starts empty; the dashboard treats events with a box name and sequence number it has already stored as spool replays and drops them, so the fresh box is silently ignored until its counter passes the old maximum. Found on the Mini-PC right after the 1.0.0 release: three healthy boxes, all "offline" on the dashboard.

## What Changes

- Every box run gets a random run id, included in every event (`run`). The dashboard deduplicates on box, run and sequence number, so a recreated container is a new run and its events are stored.
- The watcher keeps its state (run id, sequence counter, read offsets per transcript) in the config directory, which survives container recreation, so a restarted watcher resumes where it stopped instead of re-sending what it already reported. When no state exists, transcripts present at start are reported as summaries only; live events start with new lines.
- The dashboard orders and pages a session's events by its own storage order (`id`) instead of the box's sequence number, which is only unique within a run; `before=<id>` replaces `before=<seq>`.
- Entrypoint events (`--emit`) use the same run id with their own counter namespace, so they never collide with the watcher's numbers.

Out of scope: content-based deduplication, multi-dashboard setups.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `status-dashboard`: "Ingest endpoint" deduplicates on box, run and sequence; "Read API and live updates" pages by `id`.
- `status-reporting` (still a delta in the open change `box-status-reporting`): the run id and the persisted state are added there as a new requirement, so that this change carries only the dashboard side.

## Impact

- `crb-watch.js`: run id, state file in `CLAUDE_CONFIG_DIR`, backfill rule, emit namespace; `tests/watch.test.sh`.
- `dashboard/server/db.js` (table rebuild with the new key, `id` in event rows), `server/index.js` (`before=<id>`), `web` (`id` instead of `seq` for keys and paging), `test/db.test.js`.
- Existing dashboard databases are migrated on start (rows keep an empty run).
