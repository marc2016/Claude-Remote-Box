# Tasks

## 1. Watcher

- [x] 1.1 Run id, state file in the config directory, offsets, backfill rule, emit namespace (D1, D2); add the requirement "Run identity and resume" to `box-status-reporting`'s `status-reporting` delta. Verify in `tests/watch.test.sh`: events carry `run`; a restarted daemon continues `seq` and does not re-send lines it already reported; with the state file removed, existing transcripts yield only summaries and a new run id; `--emit` events carry `run` ending in `.e`.

## 2. Dashboard

- [x] 2.1 Table rebuild with `(box, run, seq)`, `id` on returned events, `before=<id>` (D3); `node --test`: a second run with repeated sequence numbers is stored and the box shows up again; a database with the old schema is rebuilt and keeps its rows; paging by `id`.
- [x] 2.2 Web app keys and pages by `id`; Playwright detail checks pass; `npm run typecheck` and `npm run build` pass.

## 3. Release

- [ ] 3.1 Commit, `./release.sh 1.0.1`, `./crb update` on the Mini-PC; verify that the three boxes show as up on the dashboard within a minute of recreation.
