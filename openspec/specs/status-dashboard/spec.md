# status-dashboard Specification

## Purpose
A web page, built for the phone, that shows every box of an installation as a card with its phase, its active session, what Claude is doing, and whether it waits for the user, fed live by the boxes' status reports.

## Requirements

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
The dashboard SHALL serve `GET /api/boxes` with every box, its state, and its sessions ordered by last activity, `GET /api/sessions/<id>/events?limit=<n>&before=<seq>` with that session's prompts, replies, tool calls and results, newest last, limited to `n` entries (default 200) and, when `before` is given, only entries with a smaller sequence number, so that older entries can be loaded page by page, and `GET /api/events` as a Server-Sent Events stream that sends an update whenever stored data changed, at most every 500 ms. The read API SHALL NOT require the ingest token.

#### Scenario: Live update
- **WHEN** a browser holds the SSE stream open and a box posts a batch
- **THEN** the browser receives an update event within one second

#### Scenario: Older entries
- **WHEN** a session has 500 events and the client requests `limit=200&before=<seq of its oldest loaded entry>`
- **THEN** the response holds the 200 entries right before that sequence number, newest last

### Requirement: Cards
The web app SHALL show one card per box with, in this order: a header with status dot, phase, box name and permission mode; the mascot strip; a status box; a session block of four rows; a footer. The status box SHALL always be two text lines high and SHALL show the state in its color: green "Arbeitet" with the last tool call, amber "Wartet auf dich" with the elapsed time and the waiting tool, grey "Idle seit …" with the last tool call, grey "Session beendet" with its time, grey "Offline seit …" with the last heartbeat, grey "Noch keine Session", amber "Setup fehlt" with `docker compose exec -it <name> setup` (or, for `waiting-config`, the hint to check the logs), red "Startet neu". The session block SHALL always show the same four rows: the session's age (time since it started, plus "zuletzt" with day and time when the last activity was not today) and model; context size against the model's window; token totals, turns and tool calls; git branch with commits ahead and dirty file count. A row without data SHALL show a dash so that its height is kept. The footer SHALL always be present with the session link and an "Öffnen" control; without a session the session link SHALL be disabled. The session's first prompt SHALL NOT be shown as a heading; it stays in the conversation and as the session row's hover text. All cards SHALL have the same height at a given viewport width. The card SHALL NOT contain a collapsible timeline; tapping the card or its "Öffnen" control SHALL open the detail view. Cards SHALL stack in one column on screens narrower than 640 px and form a grid above. The app SHALL follow the device's light or dark mode.

#### Scenario: Equal heights
- **WHEN** the page shows a working, a waiting, an ended and a `waiting-setup` box at 390 px width
- **THEN** all four cards have the same height, and the same holds at 1280 px

#### Scenario: Working box
- **WHEN** a session is `working` and its last tool call was `Edit src/nav.css`
- **THEN** the status box is green and reads "Arbeitet" above "Edit src/nav.css"

#### Scenario: Waiting box
- **WHEN** a session has waited three minutes for `Bash npm test`
- **THEN** the status box is amber and reads "Wartet auf dich · 3 min" above "Bash: npm test", and it is the most prominent element of the card

#### Scenario: Setup pending
- **WHEN** a box reports phase `waiting-setup`
- **THEN** the status box is amber and reads "Setup fehlt" above `docker compose exec -it <name> setup`, and the session rows show dashes

#### Scenario: Expand
- **WHEN** the user taps a card
- **THEN** the detail view of that box opens and the card does not expand in place

#### Scenario: Phone layout
- **WHEN** the page is opened on a 390 px wide screen with three boxes
- **THEN** three cards appear one below the other, each readable without horizontal scrolling

#### Scenario: Session line
- **WHEN** a session started two hours ago and was last active ten minutes ago
- **THEN** the session row reads "seit 2 h" on the left and the model on the right, without the first prompt

#### Scenario: Older session
- **WHEN** a session's last activity was yesterday evening
- **THEN** the session row adds "zuletzt" with that day and time

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

### Requirement: Mascot on the card
Each card SHALL show a strip between the header and the status box with a small pixel Clawd whose pose and motion follow the state: `working` walks back and forth across the full strip, turning at the edges; `idle` sits with half-closed eyes, breathes slowly and blinks now and then; `waiting` stands with wide eyes and a pulsing exclamation mark and bounces in place; `ended` and an offline box lie down in a muted color with rising "z z z"; `waiting-setup` and `waiting-config` stand still holding a wrench. The strip SHALL contain only the mascot and SHALL NOT exceed 36 px in height. Animations SHALL be CSS-driven, SHALL not change the card's layout while running, and SHALL stop (static pose) when the device prefers reduced motion. The mascot SHALL use the theme's accent color when active and the muted foreground color when asleep.

#### Scenario: Working session
- **WHEN** a session is `working`
- **THEN** Clawd walks across the whole strip, legs alternating, and turns around at the edges without leaving the card

#### Scenario: Waiting session
- **WHEN** a session is `waiting`
- **THEN** Clawd bounces in place with an exclamation mark above the amber status box

#### Scenario: Offline box
- **WHEN** a box is down or its session has ended
- **THEN** Clawd lies down in grey with "z z z" and nothing else on the card moves

#### Scenario: Reduced motion
- **WHEN** the device reports `prefers-reduced-motion: reduce`
- **THEN** each pose is shown without animation

#### Scenario: No extra height
- **WHEN** the strip is measured on any card
- **THEN** it is at most 36 px high and the same on every card

### Requirement: Session detail view
Tapping a card SHALL open a detail view for that box. The transition SHALL animate the card growing into the view where the browser supports view transitions and SHALL switch without animation elsewhere. The open box SHALL be reflected in the URL hash so that the browser's back navigation, the Escape key, and a close button all close the view, and opening the page with that hash opens the view directly. From 768 px viewport width up, the view SHALL show the card's information (header, mascot, status box, session rows, session link) on the left and the conversation on the right; below that width the information SHALL stand compactly on top and the conversation SHALL fill the remaining height. The conversation SHALL show the active session's entries newest last: prompts as user bubbles, replies as agent messages rendered from Markdown, tool calls as compact trace lines with the tool name and summary and a state of running, done, or error, and, while the session waits for the user, the pending tool line in the state "Freigabe ausstehend". The conversation SHALL update from the live stream without polling, SHALL keep the view at the bottom while the user is at the bottom and otherwise offer a control to jump to new entries, and SHALL load older entries on demand at the top. When the box has no session, the conversation area SHALL say so.

#### Scenario: Open and close
- **WHEN** the user taps the card of `janus-note-vs`
- **THEN** the detail view opens with `#janus-note-vs` in the URL, and pressing back, Escape, or the close button returns to the grid with the hash removed

#### Scenario: Deep link
- **WHEN** the page is opened at `/#looptalk`
- **THEN** the detail view of `looptalk` is shown without a tap

#### Scenario: Two columns
- **WHEN** the detail view is shown at 1280 px width
- **THEN** the information stands on the left and the conversation on the right, both visible without scrolling the page

#### Scenario: Phone
- **WHEN** the detail view is shown at 390 px width
- **THEN** the information is a compact block on top and the conversation scrolls below it, with no horizontal overflow

#### Scenario: Live conversation
- **WHEN** the detail view is open and the box reports a new reply
- **THEN** the reply appears within one second, rendered from Markdown, and the view stays at the bottom if it was there

#### Scenario: Waiting tool
- **WHEN** the session waits for approval of `Bash npm test`
- **THEN** that tool line shows "Freigabe ausstehend" until a result or a resume arrives

#### Scenario: Older entries
- **WHEN** the user scrolls to the top of a conversation with more than 200 entries and taps "frühere Einträge"
- **THEN** the previous 200 entries are inserted above without losing the scroll position
