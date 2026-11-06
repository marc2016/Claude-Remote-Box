# Proposal

## Why

The boxes now report their phase and session activity over HTTP (`box-status-reporting`), but nothing receives it yet. The user wants one page, mostly opened on the phone, that shows every box as a card: is it up, which session runs, what is Claude doing, and above all, is it waiting for an approval. Today that takes the Claude app per session and a terminal for `docker compose ps`.

## What Changes

- A new component, the status dashboard: one Node.js server with a React web app, shipped as its own image `ghcr.io/marc2016/claude-remote-box-dashboard`, run as one more Compose service in the installation. It receives the boxes' events on `/api/ingest` (bearer token), stores them in SQLite in its own volume, serves the cards as JSON and pushes updates over Server-Sent Events, and serves the built web app.
- The web app shows one card per box: status dot and phase, permission mode, the active session with its name, model, context size and token totals, what is happening now ("waiting for approval: Bash npm test, 3 min", "working: Edit app.ts", "idle since 40 min"), git state (branch, commits ahead, dirty files), and a link that opens the session in the Claude app. Tapping a card expands the session's timeline: prompts, replies, tool calls. Cards stack on a phone and form a grid on a laptop; light and dark mode follow the device.
- `crb dashboard` adds the service to an installation: generates `CRB_STATUS_TOKEN` into `.env`, writes `services/crb-dashboard.yaml` with the SQLite volume and the port binding, and adds `CRB_STATUS_URL` and `CRB_STATUS_TOKEN` to the `box` service in `box.yaml`, so every box reports. `crb update` adds the two variables to a `box.yaml` that lacks them when the dashboard service exists.
- The port binds to `127.0.0.1:8080` by default; `CRB_DASHBOARD_BIND` in `.env` changes it (for example `0.0.0.0:8080` for the LAN). There is no login in this change. The README states plainly that whoever reaches the page sees prompts and replies, and that the page belongs on a private network or behind a VPN until authentication exists.
- Stack: Node 26 with `node:http`, `node:sqlite`; React 19, Vite, TypeScript, Tailwind, shadcn/ui; one `dashboard/` project with `server/`, `web/`, `shared/`; a multi-stage Dockerfile whose runtime stage holds only the server and `web/dist`.

Out of scope: authentication and TLS, acting on boxes or git (push, PR, worktree cleanup), chat with sessions (the link into the Claude app covers it), CPU/memory metrics, multi-host hubs.

## Capabilities

### New Capabilities

- `status-dashboard`: receiving, storing, and showing box status: the ingest contract (as sent by `status-reporting`), retention, the card model and its derived states (up/down, waiting, working, idle), live updates, the session link, and the exposure defaults.

### Modified Capabilities

- `project-scaffolding`: new subcommand `crb dashboard` that adds the dashboard service and wires the boxes to it. This capability is a delta in `add-project-script` and `crb-update-command`; this change is archived after them.
- `installation-update`: `crb update` reconciles the two status variables in `box.yaml` when the dashboard service exists. This capability is a delta in `crb-update-command`; this change is archived after it.

## Impact

- New directory `dashboard/` (Node project with `package.json`, `server/`, `web/`, `shared/`, `Dockerfile`), its own tests (`node --test` for the server, a seed script for the UI).
- `.github/workflows/image.yml`: a second build for the dashboard image, same tag scheme.
- `crb`: `dashboard` subcommand, `update` reconciliation, usage line; `tests/crb.test.sh`.
- `README.md`: new section "Status dashboard" (what it shows, how to add it, exposure warning), quick-start mention; `compose.example.yaml` gets a commented dashboard service.
- No change to the box image beyond what `box-status-reporting` did.
