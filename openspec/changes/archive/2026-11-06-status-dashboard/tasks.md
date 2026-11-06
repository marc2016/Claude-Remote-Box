# Tasks

## 1. Spike

- [ ] 1.1 Find the URL that opens a Remote Control session in the Claude app or claude.ai/code: read the session URL that `claude remote-control` prints on start and compare it with a session id from a transcript; test the link on the phone. Record the pattern (or that there is none) in design.md D5 and implement `sessionUrl()` in `shared/` accordingly.

## 2. Server

- [x] 2.1 Scaffold `dashboard/` (package.json with pinned versions, `server/`, `web/`, `shared/types.ts` with the event contract from `box-status-reporting` D2 and the card model). Verify `npm install` and `npm run build` succeed from a clean checkout.
- [x] 2.2 Implement SQLite storage (D2): schema, `INSERT OR IGNORE` ingest in one transaction, state updates for sessions and boxes, pruning on start and every 6 h. Verify with `node --test`: a batch stores all events; a replay stores none twice; `waiting` then `tool_result` clears `waiting_since`; pruning removes an event dated 8 days ago and keeps a session dated 30 days ago.
- [x] 2.3 Implement the HTTP server (D4): `POST /api/ingest` with token check and `400`/`401`/`204`, `GET /api/boxes`, `GET /api/sessions/:id/events`, SSE `GET /api/events` debounced to 500 ms, static files from `web/dist` with SPA fallback. Verify with `node --test` against a running instance: wrong token gives `401`; a valid batch gives `204` and an SSE `changed` message within one second; `/api/boxes` shows the derived states from D3 for an up box, a down box (heartbeat 2 min old), a waiting session, and a `waiting-setup` box.

## 3. Web app

- [x] 3.1 Set up Vite + React + TypeScript + Tailwind + shadcn/ui in `web/` with the components from D5, light and dark mode from the device, and a `seed.ts` script that posts a realistic stream (three boxes: one waiting, one working, one in `waiting-setup`) to a local server. Verify `npm run dev` with the seed shows three cards.
- [x] 3.2 Build the card (D5): header, waiting alert, activity line, session block with context bar and totals, git line, session link or copy button, expand to the timeline, elapsed times ticking locally. Verify against the seed in the browser at 390 px and 1280 px: one column vs grid, waiting is the most prominent element, `waiting-setup` shows the setup command, expand and collapse work, and the live update arrives after posting a new event.

## 4. Image and release

- [x] 4.1 Write `dashboard/Dockerfile` (D1 multi-stage, runtime as `node`, `/data` for the volume, `PORT` 8080) and add the second build to `image.yml` (D8). Verify `docker build dashboard` locally, that the runtime image has no `node_modules` from the web build, and that `docker run -v data:/data -e CRB_STATUS_TOKEN=t -p 127.0.0.1:8080:8080 <image>` serves the page and accepts a seed.

## 5. crb

- [x] 5.1 Add `crb dashboard` (D6): token into `.env`, service file, include line, two environment lines in `box.yaml` (creating the `environment:` block when missing), summary, confirmation, validate and roll back, "already present" exit, single-file hint. Verify in `tests/crb.test.sh`: after `dashboard` on an installation with two boxes, `docker compose config` shows the dashboard with the loopback port and one volume and both boxes with URL and token; a second run changes nothing; a declined summary changes nothing; single-file setup prints the hint.
- [x] 5.2 Add the status-variables item to `crb update` (spec "Status variables reconciled") and its test: dashboard service present, variables missing, accepted, both variables in every box and all boxes listed for recreate; already wired, no question.

## 6. Documentation

- [x] 6.1 README: section "Status dashboard" (what the cards show, `./crb dashboard`, `CRB_DASHBOARD_BIND`, the no-login warning and the VPN/LAN advice, how the link into the app works), a line in the quick start, `compose.example.yaml` with a commented dashboard service, `crb` usage line. Verify `docker compose -f compose.example.yaml config -q` passes and the README names every environment variable the service uses.

## 7. Field test

- [ ] 7.1 On the Mini-PC: `./crb dashboard`, `docker compose up -d`, open the page on the phone over the LAN or VPN, use `janus-note-vs` from the Claude app and watch the card: working, waiting on a permission prompt in `default` mode, reply, git line after a commit; recreate the dashboard and confirm history is still there. Record the result in design.md.
