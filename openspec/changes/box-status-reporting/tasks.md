# Tasks

## 1. Spikes

- [ ] 1.1 Build a throwaway image with `/etc/claude-code/managed-settings.json` containing a `Notification` hook that appends a line to `/tmp/hook.log`, and a marker sentence in the managed `CLAUDE.md`; start a session from the phone, trigger a permission prompt, and check the log and whether Claude quotes the marker. Record both answers in design.md (D3) and in `browser-screenshots` task 1.1.
- [ ] 1.2 Copy one real transcript from a box running the pinned Claude Code version (`projects/**/*.jsonl` in a config directory) and list its line types and the fields on `user`/`assistant` lines; record the differences to D2's assumptions in design.md and adjust the event mapping before writing the parser.

## 2. Watcher

- [x] 2.1 Write `crb-watch.js` (D1, D2): file discovery with offsets, line parsing, event mapping for session start, prompt, reply, tool, tool_result, session end, and the per-session summary with token totals and context size; `--emit key=value` mode for the entrypoint. Verify with a unit-style run against a saved transcript: `node crb-watch.js --dry-run <file>` prints the expected events in order and the final summary totals match the usages summed by hand.
- [x] 2.2 Add the sender (D4): batching, bearer token, 2 s timeout, spool with the 500-line bound, backoff, drain-in-order; and the heartbeat every 30 s. Verify with `tests/receiver.js`: 20 events sent while the receiver is down arrive in order after it starts; with 700 events the spool file holds 500 and the log notes the loss once; heartbeats are not in the spool.
- [x] 2.3 Add the waiting heuristic (D3): `waiting` 10 s after a `tool_use` without result, `resumed` on the result. Verify with a transcript where the result line is appended 15 s later: both events arrive with the right tool summary.
- [x] 2.4 Add backfill rules (D1): on start, sessions older than 24 h produce only a summary. Verify by starting the watcher on a directory with an old and a new transcript: the receiver gets one summary for the old and full events for the new.

- [x] 2.5 Add the `git` event (spec "Git state"): on each heartbeat run `git worktree list --porcelain`, and per worktree `git rev-list --count <default>..HEAD`, `git status --porcelain`, `git diff --shortstat <default>...HEAD`, `git log -1 --format=%s%x00%cI`, all read-only with a 5 s timeout; skip when `/workspace` is not a repository. Verify in `tests/watch.test.sh` with a temporary repository that has one worktree with two commits and a modified file: the event lists both checkouts with the expected `ahead`, `dirty`, branch, and subject; and that a plain directory produces no `git` event.

- [x] 2.6 Run identity and resume (spec "Run identity and resume", added by `watcher-run-identity`): run id in every event, state file in the config directory, resume from offsets, summaries-only backfill without state, emit namespace. Verified in `tests/watch.test.sh` (restart continues seq without re-sending, fresh state gives a new run and summaries only).

## 3. Entrypoint and image

- [x] 3.1 Add `crb_report_phase` to `crb-common.sh` and use it for every phase change (D5); send heartbeats from the waiting loops. Verify with the fake `claude` and `tests/receiver.js`: a box without login reports `waiting-setup` and heartbeats; after the marker appears, `running` arrives before the fake server's first output.
- [x] 3.2 Start and supervise the watcher as a second child in `entrypoint.sh` (D5), restart after 5 s on exit, forward stop signals, skip it in passthrough mode and when `CRB_STATUS_URL` is unset. Verify: `kill` of the watcher inside a running container is followed by a restart within 10 s and the server keeps its PID; `docker compose stop` ends both within 5 s; without the URL, `ps` shows no watcher.
- [x] 3.3 Copy `crb-watch.js` into the image (`/usr/local/lib/crb/`), and, if 1.1 says hooks fire, add `managed-settings.json` with the `Notification` hook (D3). Verify that `docker run <image> node /usr/local/lib/crb/crb-watch.js --version` prints the version and, when shipped, that the hook file is root-owned and mode 0644.

## 4. Tests

- [x] 4.1 Add `tests/receiver.js` (records POST bodies and headers to a JSONL file, can be paused and resumed through a control file) and extend the fake `claude` in `tests/fake/claude` to write a transcript in the verified shape when it runs as the server. Verify by running the new scenarios in `tests/setup.test.sh`: configured box sends phase, heartbeat, prompt, tool, tool_result, reply and summary with the token header; unconfigured box sends nothing and shows no watcher.

## 5. Documentation

- [x] 5.1 README: `CRB_STATUS_URL` and `CRB_STATUS_TOKEN` in the configuration table, a "Status reporting" section (what is sent, the privacy note from D6, the spool, that the dashboard is a separate component), and the commented variables in `compose.example.yaml`. Verify that `docker compose -f compose.example.yaml config -q` passes and that every event type from D2 is named in the README section.

## 6. Field test

- [ ] 6.1 On the Mini-PC, point `janus-note-vs` at `tests/receiver.js` running on the host (or a one-off container) and use the box from the phone for a few prompts, including one that triggers a permission prompt in `default` mode. Verify in the recorded file that prompts, tools, replies, summaries and a `waiting` event appear with plausible timing, and that the session felt no slower. Record the result in design.md.
