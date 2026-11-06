# Spec Delta

## Purpose

A web page, built for the phone, that shows every box of an installation as a card with its phase, its active session, what Claude is doing, and whether it waits for the user, fed live by the boxes' status reports.

## ADDED Requirements

### Requirement: Ingest endpoint
The dashboard SHALL accept `POST /api/ingest` with a JSON array of events as defined by `status-reporting`, SHALL require `Authorization: Bearer <token>` matching its configured token and answer `401` otherwise, SHALL answer `204` after storing, and SHALL ignore events it has already stored (same box and sequence number). Unknown event types SHALL be stored and ignored by the UI. A body that is not a JSON array SHALL get `400`.

#### Scenario: Valid batch
- **WHEN** a box posts 20 events with the right token
- **THEN** the response is `204`, all 20 are stored, and connected browsers receive an update

#### Scenario: Wrong token
- **WHEN** a request carries no token or a wrong one
- **THEN** the response is `401` and nothing is stored

#### Scenario: Replayed spool
- **WHEN** a box resends events whose box and sequence numbers were stored before
- **THEN** they are not stored twice and the response is still `204`

### Requirement: Storage and retention
The dashboard SHALL store events, per-session summaries, and per-box state in SQLite in a directory meant for a volume, so that data survives a restart. It SHALL keep events for 7 days and session summaries for 90 days, pruning at least daily, and SHALL keep the latest state of every box indefinitely.

#### Scenario: Restart
- **WHEN** the dashboard container is recreated with the same volume
- **THEN** the cards show the same sessions and history as before

#### Scenario: Pruning
- **WHEN** an event is older than 7 days
- **THEN** it is no longer returned by the API after the next pruning run

### Requirement: Box and session state
From the stored events the dashboard SHALL derive, per box: `up` while the last heartbeat is younger than 90 s and `down` otherwise, the current phase, image and Claude Code version, spawn mode, and the permission mode of its sessions; per session: name (session id, and the title or first prompt as label), model, token totals, context size, turns, tool calls, started and last-activity time, git state from the latest `git` event, and an activity state: `waiting` after a `waiting` event without a later `resumed`, `tool_result`, or `reply` (with the tool, summary, and waiting duration), `working` within 60 s of the last event, `idle` otherwise, `ended` after `session_end`.

#### Scenario: Waiting shown
- **WHEN** a box reports `waiting` for `Bash npm test` and nothing after it
- **THEN** the card shows the session as waiting with "Bash: npm test" and the elapsed time, updated every few seconds

#### Scenario: Box down
- **WHEN** no heartbeat from a box arrived for more than 90 s
- **THEN** its card shows `down` with the time of the last heartbeat, keeping the last known phase and sessions

### Requirement: Read API and live updates
The dashboard SHALL serve `GET /api/boxes` with every box, its state, and its sessions ordered by last activity, `GET /api/sessions/<id>/events?limit=<n>` with that session's prompts, replies, tool calls and results, newest last, and `GET /api/events` as a Server-Sent Events stream that sends an update whenever stored data changed, at most every 500 ms. The read API SHALL NOT require the ingest token.

#### Scenario: Live update
- **WHEN** a browser holds the SSE stream open and a box posts a batch
- **THEN** the browser receives an update event within one second

### Requirement: Cards
The web app SHALL show one card per box with: status dot and phase, box name, permission mode, the active session's label and model, the activity state with its detail, context size against the model's window where known, token totals, git branch with commits ahead and dirty file count when reported, and a link to the session in the Claude app. Waiting SHALL be the most prominent element of a card. A box in `waiting-setup` or `waiting-config` SHALL show the command to run instead of a session. Tapping a card SHALL expand the session's timeline (prompts, replies, tool calls with results) with the newest at the bottom. Cards SHALL stack in one column on screens narrower than 640 px and form a grid above. The app SHALL follow the device's light or dark mode.

#### Scenario: Phone layout
- **WHEN** the page is opened on a 390 px wide screen with three boxes
- **THEN** three cards appear one below the other, each readable without horizontal scrolling

#### Scenario: Expand
- **WHEN** the user taps a card with an active session
- **THEN** the card shows the session's recent prompts, replies and tool calls, and tapping again collapses it

#### Scenario: Setup pending
- **WHEN** a box reports phase `waiting-setup`
- **THEN** its card shows `docker compose exec -it <name> setup` instead of a session

### Requirement: Exposure defaults
The dashboard service SHALL bind its port to `127.0.0.1:8080` unless `CRB_DASHBOARD_BIND` in `.env` says otherwise, SHALL run with the same hardening as a box (non-root, `cap_drop: ALL`, `no-new-privileges`), SHALL mount only its own data volume, and SHALL have no access to the Docker socket, the boxes' config directories, or the workspaces. The documentation SHALL state that the page has no login and belongs on a private network or behind a VPN.

#### Scenario: Default binding
- **WHEN** `crb dashboard` is run without `CRB_DASHBOARD_BIND`
- **THEN** `docker compose config crb-dashboard` shows the port published on `127.0.0.1` only

#### Scenario: Mounts
- **WHEN** the dashboard service is inspected
- **THEN** it has exactly one mount, its data volume

### Requirement: Session link
Each session on a card SHALL link to that session in the Claude app or claude.ai/code, using the session id in the URL pattern the Claude app accepts. When that pattern cannot be confirmed, the card SHALL show the session id with a copy button instead.

#### Scenario: Open in app
- **WHEN** the user taps the session link on the phone
- **THEN** the Claude app or claude.ai/code opens that session
