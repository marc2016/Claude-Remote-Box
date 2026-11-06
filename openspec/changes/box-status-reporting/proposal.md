# Proposal

## Why

With two or three boxes driven from a phone, there is no place to see at a glance which boxes are up, which session is doing what, and above all which one is blocked waiting for an approval. The Claude app shows one session at a time; `docker compose ps` needs a terminal. A status dashboard (a separate, later change) needs the boxes to report what they do, and that reporting has to work without a Docker socket, without exposing the config directory that holds the login token, and without slowing the sessions down.

## What Changes

- The image gets a small watcher, `crb-watch`, a Node script started and supervised by the entrypoint next to the Remote Control server. It tails the session transcripts that Claude Code writes under the config directory (`projects/**/*.jsonl`), turns them into events, and sends them with HTTP POST to a status endpoint. It sends nothing when no endpoint is configured, so existing installations behave as today.
- Events cover: session start and end, user prompts, Claude's replies (text blocks, truncated), tool calls with their input summary and results (ok/error), per-session totals (model, input/output/cache tokens, current context size, turns, tool calls, and, where the transcript provides them, cost, lines added/removed), and a "waiting" marker when a tool call has no result after a threshold. The entrypoint phase (`waiting-config`, `waiting-setup`, `running`, `restarting`) and a heartbeat every 30 s go the same way, so the receiver can tell running from stopped boxes without the Docker socket.
- Two environment variables configure it: `CRB_STATUS_URL` (endpoint, empty = off) and `CRB_STATUS_TOKEN` (bearer token sent with every request). Failed sends are spooled in `/tmp` and retried with the next event or heartbeat, bounded in size; a send never blocks a session.
- A tiny test receiver in `tests/` records POSTs to a file, so the change is verifiable without the dashboard.
- Optional, decided by a spike: a single `Notification` hook in the image's managed settings that reports permission prompts precisely. The watcher's threshold heuristic stays as fallback.
- README: configuration table entries, a short "Status reporting" section with the privacy note (prompts and replies leave the box, to a host you run), and the state-file note.

Out of scope: the dashboard itself (image, UI, storage, `crb dashboard`), setting the variables from `crb`, CPU/memory metrics, chat from the dashboard.

## Capabilities

### New Capabilities

- `status-reporting`: what a box reports about itself and its sessions, to where, with which guarantees (opt-in, non-blocking, spooled, bounded, token-authenticated), and the event and summary contract a receiver can rely on.

### Modified Capabilities

- `container-image`: "Remote Control server by default" gains the watcher as a second supervised child when reporting is configured; the state file written by the entrypoint stays, so the healthcheck is unaffected.

## Impact

- `Dockerfile`: copy `crb-watch.js` into the image; optionally `managed-settings.json` with the one hook.
- `entrypoint.sh`: start and supervise the watcher next to the server, pass the phase to it, forward signals; `crb-common.sh`: phase reporting helper.
- New `crb-watch.js` (Node, no dependencies): transcript tailing, event mapping, spool, HTTP client, heartbeat.
- `tests/setup.test.sh`: scenarios with the fake `claude` writing a fake transcript, and the test receiver; `tests/receiver.js`.
- `README.md`, `compose.example.yaml` (commented variables).
- No change to `crb`; the dashboard change wires the variables into `box.yaml`.
