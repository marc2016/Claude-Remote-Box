# Design

## Context

See proposal.md for motivation. What shapes the approach:

- The boxes send JSON arrays of events (`status-reporting`, D2 in `box-status-reporting`): `phase`, `heartbeat`, `session_start`, `prompt`, `reply`, `tool`, `tool_result`, `waiting`, `resumed`, `summary`, `git`, `session_end`, each with `box`, `ts`, `seq`, and `session` where applicable. Heartbeats come every 30 s; 90 s without one means down. Spooled events may arrive late and in bulk, in order, and may repeat after a watcher restart.
- Installation layout: `compose.yaml` includes `services/*.yaml`, `box.yaml` holds the shared `box` service that every project extends, `.env` holds `UID`/`GID`. `crb` already knows how to add a service file, an include line, and a line under `environment:` in files it wrote.
- Decided in exploration: cards, not tables; shadcn/ui; one Node project with `server/`, `web/`, `shared/`; HTTP push; chat stays in the Claude app, the card links there; git actions and authentication are later changes.
- The user opens the page mostly on a phone over the LAN or a VPN.

## Goals / Non-Goals

**Goals:**
- One image, one service, one command to add it; boxes report without per-project configuration.
- The page answers "where am I needed" within one glance, and everything else within one tap.
- History survives restarts; late and repeated events do no harm.

**Non-Goals:**
- Authentication, TLS, multi-user, multi-host.
- Any write path back to the boxes or to git.
- Metrics charts.

## Decisions

### D1: One Node project, two halves, one image
`dashboard/` is a single npm workspace-free project: `server/` (plain Node, `node:http`, `node:sqlite`, no framework), `web/` (Vite + React 19 + TypeScript + Tailwind + shadcn/ui), `shared/types.ts` (the event contract and the card model, imported by both). The Dockerfile builds `web/` in a `node:26` stage and copies `web/dist` plus `server/` into a `node:26-slim` runtime stage running as `node`. `node --test` covers the server; the web app gets a `seed.ts` script that posts a realistic event stream to `/api/ingest` for development without boxes.
- *Alternative: Express or Fastify.* Not needed for five routes and SSE; can be added later without changing the API.
- *Alternative: PocketBase or another hub.* Rejected with the Beszel look; the data model is small and specific.

### D2: Storage in SQLite with three tables
`events(box, seq, session, ts, type, json, PRIMARY KEY(box, seq))`, `sessions(id, box, label, model, tokens_in, tokens_out, cache_read, cache_write, context, turns, tool_calls, started, last, cost_usd, lines_added, lines_removed, permission_mode, branch, git_json, state, waiting_since, waiting_text, ended_at)`, `boxes(name, phase, last_heartbeat, image, claude_version, spawn, uptime_s, updated)`. Ingest runs in one transaction per batch: insert events with `INSERT OR IGNORE` (replays are idempotent by the primary key), then apply each new event to `sessions` and `boxes`. `waiting_since` is set by `waiting` and cleared by `resumed`, `tool_result`, `reply`, or `session_end`. Pruning runs on start and every 6 h: events older than 7 days, sessions with `last` older than 90 days.
- *Alternative: derive everything from events on read.* Rejected: cards need to render fast on a phone, and 7 days of tool events per box is tens of thousands of rows.

### D3: Derived states
Box: `up` if `now - last_heartbeat < 90 s`, else `down`; phase from the last `phase` or `heartbeat`. Session: `ended` after `session_end`; `waiting` if `waiting_since` set; `working` if `now - last < 60 s`; else `idle`. The active session of a box is the non-ended session with the latest `last`. Session label: `ai-title` is not in the contract, so the label is the first prompt, truncated to 60 characters, with the session id as fallback. Context window per model is a small table in `shared/` (200k default) used only for the ratio.

### D4: API and SSE
`POST /api/ingest` (token), `GET /api/boxes`, `GET /api/sessions/:id/events?limit=200`, `GET /api/events` (SSE). The SSE stream carries only a `changed` signal with the affected box names, debounced to 500 ms; the client refetches `/api/boxes` on it, so there is one shape of truth. The web app also refetches every 30 s and recomputes elapsed times every 5 s locally, so "waiting 3 min" ticks without traffic.

### D5: The card
Header: dot (green `up`, grey `down`, amber `waiting-setup`/`waiting-config`, red `restarting`), name, phase badge, permission badge. Body: when waiting, an `Alert` in warning color with tool, summary, elapsed time; otherwise one line of activity (`working: Edit app.ts`, `idle since 40 min`). Session block: label, model, context bar (`Progress`), tokens in/out, turns, tool calls; git line when present. Footer: session link button and expand chevron. Expanded: timeline from `/api/sessions/:id/events`, prompts right-aligned, replies left, tools as compact rows with ok/error icon. shadcn components used: `Card`, `Badge`, `Alert`, `Progress`, `Button`, `Skeleton`, `Collapsible`, `ScrollArea`. Tailwind breakpoint `sm` (640 px) switches from one column to the grid.

### D6: `crb dashboard` and the wiring
The subcommand reuses `add`'s machinery: `write_env_line` for `box.yaml` (the `box` service has `environment:`? It does not today, so the function gains "create the block after `image:` when missing"), include insertion, backup/validate/restore. The token comes from `head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 32` into `.env`. The service file:

```yaml
services:
  crb-dashboard:
    image: ghcr.io/marc2016/claude-remote-box-dashboard:latest
    restart: unless-stopped
    user: "${UID:-1000}:${GID:-1000}"
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    environment:
      CRB_STATUS_TOKEN: "${CRB_STATUS_TOKEN}"
    ports:
      - "${CRB_DASHBOARD_BIND:-127.0.0.1:8080}:8080"
    volumes:
      - "crb-dashboard-data:/data"
volumes:
  crb-dashboard-data: {}
```

`box.yaml` gets `CRB_STATUS_URL: "http://crb-dashboard:8080/api/ingest"` and `CRB_STATUS_TOKEN: "${CRB_STATUS_TOKEN}"`. The boxes pick it up on their next recreate; the command prints `docker compose up -d` for all. `crb update` checks the same two lines (D3 of `crb-update-command`, one more reconcile item).

### D7: Exposure
Default bind `127.0.0.1:8080`: on a headless Mini-PC that means "reachable through SSH tunnel or a reverse proxy you control" until the user sets `CRB_DASHBOARD_BIND=0.0.0.0:8080` for the LAN or a VPN interface address. No login in this change; the README says what that means. Authentication is the next change and will add a login screen and a cookie session to this same server.

### D8: Image publishing
`image.yml` gets a second `build-push-action` step with `context: dashboard`, tags `claude-remote-box-dashboard:<version>`, `:latest`, no `claude-<version>` tag (the dashboard does not pin Claude Code). The same `v*` tag releases both images, so one release means one version number for the whole project.

## Implementation notes

- `sessionUrl()` in `shared/model.js` returns `null` until task 1.1 confirms the pattern; the card shows the session id with a copy button, as the spec's fallback says.
- shadcn/ui components were written by hand in `web/src/components/ui/` in shadcn's style (Radix primitives, `cva`, `cn`) instead of through the shadcn CLI, which is interactive; same result, pinned versions. `ScrollArea` was dropped: Radix renders its viewport as a table, which broke the phone width; a plain `overflow-y-auto` does the job.
- The visual check (390 px and 1280 px, light and dark, expanded timeline) was done with Playwright screenshots against the seed; all three pass with no horizontal overflow after adding `min-w-0` to truncating flex children.
- `box_env_line` creates the `environment:` block in `box.yaml` after the `image:` line when missing (D6), so installations created by earlier `crb` versions work.
- `crb update` skips `services/crb-dashboard.yaml` in its per-project loop; it is a service, not a project.
- Server tests run with `node --test` (`dashboard/test/`), no Docker; the image was built locally and smoke-tested with the seed under a foreign UID.

## Risks / Trade-offs

- [Session link pattern unknown] → task 1.1 checks a session URL from `claude remote-control` output and the app; the card falls back to the id with a copy button.
- [Event flood after a spool drain] → one transaction per batch, SSE debounced, the client refetches a summary endpoint, never the raw events.
- [Clock skew between boxes and dashboard] → `up`/`down` uses the dashboard's receipt time, not the box's `ts`.
- [Page reachable without login] → default loopback bind, README warning, authentication as the next change.
- [shadcn/Tailwind churn] → components are copied into the repo; versions pinned in `package.json`.

## Migration Plan

New component; nothing changes for installations that do not run `crb dashboard`. Add: `./crb dashboard`, `docker compose up -d`. Remove: delete `services/crb-dashboard.yaml`, the two lines in `box.yaml`, and the include line; `docker compose up -d`.

## Open Questions

- The exact URL pattern that opens a session in the Claude app (task 1.1). Changes one function in the web app.
