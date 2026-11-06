# Design

## Context

See proposal.md for motivation. What shapes the approach:

- Claude Code writes one JSONL transcript per session under `$CLAUDE_CONFIG_DIR/projects/<encoded cwd>/<session-id>.jsonl`, subagent transcripts in a subdirectory next to it. Worktree sessions have another cwd and therefore another project directory, all under the one config directory the box already mounts. A look at a current transcript shows per line a `type` (`user`, `assistant`, `system`, plus bookkeeping types such as `cost-state`, `ai-title`, `last-prompt`), and on `user`/`assistant` lines `sessionId`, `cwd`, `gitBranch`, `version`, `timestamp`, `permissionMode`, and `message` with `model`, `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and `content` blocks of type `text`, `thinking`, `tool_use`, `tool_result`. `cost-state` lines carry `totalCostUSD`, `totalLinesAdded`, `totalLinesRemoved`. The image pins Claude Code 2.1.316; its transcript may lack some bookkeeping types, so everything beyond `user`/`assistant` is optional input.
- The entrypoint already supervises the server as a child with signal forwarding and a state file; `node` is in the image; `curl` is not needed because Node's `http`/`https` do the sending.
- Hooks were considered as the data source and rejected as the backbone: each hook is a process start per tool call, and whether managed-settings hooks fire in Remote Control sessions is unverified. A single `Notification` hook is kept as an optional precision add-on.
- Decided in exploration: HTTP push to a receiver (not a shared volume), token-authenticated, with the dashboard as a separate change.

## Goals / Non-Goals

**Goals:**
- Zero overhead inside a session; the watcher only reads files.
- A receiver contract (event types and fields) stable enough that the dashboard can be built against it.
- Safe defaults: off unless configured, bounded spool, truncated text, never blocking.

**Non-Goals:**
- Delivery guarantees beyond "in order, best effort, bounded spool".
- Parsing thinking blocks or tool results in detail; only presence and ok/error.
- Any `crb` change; the dashboard change sets the variables.

## Decisions

### D1: One Node watcher, no dependencies
`crb-watch.js` runs with the image's Node. It scans `projects/` on start and every 5 s for new `.jsonl` files (cheap `readdir`, no recursive `fs.watch` to avoid inotify limits on bind mounts), keeps a read offset per file, reads appended bytes, splits lines, and parses each as JSON. Lines that fail to parse are skipped and counted. On start it reads existing transcripts from the beginning but marks events older than 24 h as `backfill: true` and sends only summaries for them, so a restart does not replay days of history.
- *Alternative: hooks.* See Context.
- *Alternative: a shell watcher with `tail -F`.* Rejected: JSON parsing and HTTP in shell are fragile; `node` is already there.

### D2: Event contract
Every POST is a JSON array of events (batched per 500 ms or 50 events) so a busy session does not produce one request per line. Each event:

```json
{ "box": "janus-note-vs", "ts": "2026-11-06T12:03:04Z", "seq": 1234,
  "session": "7f3a...", "type": "tool",
  "tool": "Bash", "summary": "npm test" }
```

Types and extra fields: `phase {phase}`, `heartbeat {phase, uptime_s, image, claude_version, spawn}`, `session_start {cwd, branch, claude_version, permission_mode}`, `prompt {text}`, `reply {text}`, `tool {tool, summary, call_id}`, `tool_result {call_id, ok}`, `waiting {tool, summary, source: "heuristic"|"hook"}`, `resumed {}`, `summary {model, tokens_in, tokens_out, cache_read, cache_write, context, turns, tool_calls, started, last, cost_usd?, lines_added?, lines_removed?}`, `session_end {reason}`. Tool summaries: `Bash` → command, `Edit`/`Write`/`Read` → path, `Grep`/`Glob` → pattern, else the first string input, 200 characters max. `seq` is per box and monotonic across restarts (persisted in `/tmp` best effort), so the receiver can detect gaps and duplicates.

### D3: Waiting heuristic
A `tool_use` block without a matching `tool_result` (by `tool_use_id`) after 10 s produces `waiting`. The permission prompt and a long-running tool look the same here; the dashboard shows "waiting or running long" with the elapsed time, which is honest. If the spike in task 1.1 shows that managed-settings hooks fire in Remote Control sessions, the image ships `/etc/claude-code/managed-settings.json` with one `Notification` hook that POSTs `{type: "waiting", source: "hook"}` through the same `emit` path (a `node -e` one-liner calling `crb-watch.js --emit`). That hook runs once per prompt, not per tool call.

### D4: Delivery: batch, timeout, spool
`emit` appends to an in-memory queue; a sender drains it in batches with a 2 s request timeout. On failure the batch goes to `/tmp/crb-spool.jsonl` (newest 500 lines kept, loss logged once per outage) and the sender backs off 5 s, 10 s, 30 s, up to 60 s. When a request succeeds, the spool is drained first, in order. Heartbeats bypass the spool: a stale heartbeat is useless. Nothing here is awaited by anything the session does; the watcher is a separate process.

### D5: Supervision in the entrypoint
`entrypoint.sh` gains `crb_report_phase <phase>` (in `crb-common.sh`), which writes the state file as today and, if `CRB_STATUS_URL` is set, runs `node crb-watch.js --emit type=phase phase=<phase>` in the foreground under `timeout 3`. Foreground, not background as first planned: phase changes are rare, and sending before the next phase starts is what makes `running` arrive before the server's first output; the 3 s cap bounds the cost when the endpoint is down. In the `running` phase the entrypoint starts the watcher as a second child before the server and restarts it after 5 s if it exits; the stop trap signals both children. The watcher is not started in passthrough mode (`setup`, `bash`), and in the waiting phases only phase events and heartbeats go out, from the entrypoint loop itself, so a waiting box is visible on the dashboard too.

### D6: Privacy and the README
Prompts and replies leave the box, to a host the user runs, over the URL they configured. The README says so next to the variables, recommends `https` or a private network when the receiver is on another host, and notes that the token only authenticates the box to the receiver. Transcripts are read only, never changed.

### D7: Git state from inside the box
The box has Git and the repository, so the watcher reports the working-tree state with each heartbeat instead of the dashboard mounting repositories: `git worktree list --porcelain`, then per worktree `rev-list --count`, `status --porcelain`, `diff --shortstat` against the default branch (`origin/HEAD` if present, else `main`, else `master`), and `log -1`. All read-only, each with a 5 s timeout, results cached between heartbeats when nothing changed. Acting on Git (push, PR, merge, worktree cleanup) stays out: it needs credentials the box must not have, and belongs to a later change with a separate git agent and dashboard authentication.

### D8: Notification hook shipped unconditionally
Instead of waiting for the spike, the image ships `/etc/claude-code/managed-settings.json` with one `Notification` hook that runs `crb-watch.js --hook`. The hook appends the raw hook input to `/tmp/crb-hook.log` (bounded) and, when reporting is configured and the notification is a permission prompt, emits `waiting` with `source: hook`. If managed-settings hooks do not fire in Remote Control sessions, the file is inert and the heuristic from D3 stands alone; the spike (task 1.1) then only reads that log on the Mini-PC.

## Risks / Trade-offs

- [Transcript format differs in 2.1.316 from what was inspected] → The parser treats everything except `user`/`assistant` with `message.content` as optional; task 1.2 verifies against a real transcript from the image before the mapping is finalized, and the fake `claude` in tests writes the verified shape.
- [Permission prompt not distinguishable from a long tool] → Documented as such; hook add-on if the spike allows.
- [Backfill floods the receiver on first start] → Only summaries for old sessions; full events only for lines newer than 24 h.
- [Watcher reads the config directory that holds the token] → It runs inside the box, where the token is reachable anyway; it opens only `projects/**/*.jsonl` and sends extracted fields, never file contents or paths outside `projects/`.
- [Large transcripts] → Offset-based reads; a 50 MB transcript costs one pass at start, then only appended bytes.
- [Bind-mounted config on a host with many inotify users] → No `fs.watch`; polling `readdir` every 5 s plus `stat` per known file.

## Migration Plan

Image change only; nothing happens until `CRB_STATUS_URL` is set. The dashboard change adds the variables to `box.yaml` through `crb`. Rollback: unset the variable.

## Implementation notes

- The watcher tests (`tests/watch.test.sh`) run without Docker and cover parsing, sender, spool bound, waiting heuristic, and backfill against a fixture transcript in the inspected shape; the container tests (`tests/setup.test.sh`, section 5) cover phase, heartbeat, session events from the fake `claude`'s transcript, watcher restart, stop, and the unconfigured case.
- Task 1.2 (transcript of the pinned version) is still open: the parser accepts the inspected shape and ignores unknown line types, so a difference would show up as missing events, not as a crash.

## Open Questions

- Whether managed-settings hooks fire in Remote Control sessions (task 1.1). Changes only whether the `waiting` event is exact or heuristic.
