# Spec Delta

## MODIFIED Requirements

### Requirement: Ingest endpoint
The dashboard SHALL accept `POST /api/ingest` with a JSON array of events as defined by `status-reporting`, SHALL require `Authorization: Bearer <token>` matching its configured token and answer `401` otherwise, SHALL answer `204` after storing, and SHALL ignore events it has already stored (same box and sequence number). Unknown event types SHALL be stored and ignored by the UI. A body that is not a JSON array SHALL get `400`. A request that was forwarded by a proxy (it carries `X-Forwarded-For` or `Forwarded`) SHALL be answered with `403` without reading the body or checking the token, unless `CRB_DASHBOARD_REMOTE_INGEST=1` is set. The ingest endpoint SHALL NOT require or accept a user session.

#### Scenario: Valid batch
- **WHEN** a box posts 20 events with the right token
- **THEN** the response is `204`, all 20 are stored, and connected browsers receive an update

#### Scenario: Wrong token
- **WHEN** a request carries no token or a wrong one
- **THEN** the response is `401` and nothing is stored

#### Scenario: Replayed spool
- **WHEN** a box resends events whose box and sequence numbers were stored before
- **THEN** they are not stored twice and the response is still `204`

#### Scenario: Through the proxy
- **WHEN** a request with the right token arrives with an `X-Forwarded-For` header and `CRB_DASHBOARD_REMOTE_INGEST` is not set
- **THEN** the response is `403` and nothing is stored

#### Scenario: Remote boxes enabled
- **WHEN** `CRB_DASHBOARD_REMOTE_INGEST=1` is set and the same request arrives
- **THEN** the response is `204` and the events are stored

### Requirement: Read API and live updates
The dashboard SHALL serve `GET /api/boxes` with every box, its state, and its sessions ordered by last activity, `GET /api/sessions/<id>/events?limit=<n>&before=<seq>` with that session's prompts, replies, tool calls and results, newest last, limited to `n` entries (default 200) and, when `before` is given, only entries with a smaller sequence number, so that older entries can be loaded page by page, and `GET /api/events` as a Server-Sent Events stream that sends an update whenever stored data changed, at most every 500 ms. These three routes SHALL require a valid user session as defined by `dashboard-auth` and SHALL answer `401` without one, unless the login is switched off; the ingest token SHALL NOT grant access to them. An open event stream SHALL be closed by the dashboard when its session ends.

#### Scenario: Live update
- **WHEN** a signed-in browser holds the SSE stream open and a box posts a batch
- **THEN** the browser receives an update event within one second

#### Scenario: Older entries
- **WHEN** a session has 500 events and the signed-in client requests `limit=200&before=<seq of its oldest loaded entry>`
- **THEN** the response holds the 200 entries right before that sequence number, newest last

#### Scenario: No session
- **WHEN** `/api/boxes`, a session's events, or `/api/events` is requested without a session cookie, or with the ingest token as bearer
- **THEN** the response is `401` and contains no box, session, or event data

#### Scenario: Stream after sign-out
- **WHEN** a browser holds the SSE stream open and its session is ended
- **THEN** the stream is closed and delivers no further update

### Requirement: Exposure defaults
The dashboard service SHALL bind its port to `127.0.0.1:8080` unless `CRB_DASHBOARD_BIND` in `.env` says otherwise, SHALL run with the same hardening as a box (non-root, `cap_drop: ALL`, `no-new-privileges`), SHALL mount only its own data volume, and SHALL have no access to the Docker socket, the boxes' config directories, or the workspaces. Every response SHALL forbid framing by other sites, SHALL forbid content-type sniffing, and SHALL tell the browser to send no referrer. The documentation SHALL describe how to publish the dashboard through a reverse proxy that terminates TLS, SHALL state that the login is the only protection of the stored prompts and replies once the dashboard is reachable from outside, that the port itself speaks plain HTTP and has to be reachable only by the proxy, and that with the login switched off the page belongs on a private network or behind a VPN.

#### Scenario: Default binding
- **WHEN** `crb dashboard` is run without `CRB_DASHBOARD_BIND`
- **THEN** `docker compose config crb-dashboard` shows the port published on `127.0.0.1` only

#### Scenario: Mounts
- **WHEN** the dashboard service is inspected
- **THEN** it has exactly one mount, its data volume

#### Scenario: Response headers
- **WHEN** the page, a static file, or an API route is requested
- **THEN** the response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a header that forbids framing
