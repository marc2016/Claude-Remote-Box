# Spec Delta

## MODIFIED Requirements

### Requirement: Ingest endpoint
The dashboard SHALL accept `POST /api/ingest` with a JSON array of events as defined by `status-reporting`, SHALL require `Authorization: Bearer <token>` matching its configured token and answer `401` otherwise, SHALL answer `204` after storing, and SHALL ignore events it has already stored (same box, run id and sequence number; events without a run id count as one run). Events of a new run of a box SHALL be stored even when their sequence numbers repeat those of an earlier run. Unknown event types SHALL be stored and ignored by the UI. A body that is not a JSON array SHALL get `400`.

#### Scenario: Valid batch
- **WHEN** a box posts 20 events with the right token
- **THEN** the response is `204`, all 20 are stored, and connected browsers receive an update

#### Scenario: Wrong token
- **WHEN** a request carries no token or a wrong one
- **THEN** the response is `401` and nothing is stored

#### Scenario: Replayed spool
- **WHEN** a box resends events whose box, run and sequence numbers were stored before
- **THEN** they are not stored twice and the response is still `204`

#### Scenario: Recreated container
- **WHEN** a box reports with a new run id and sequence numbers starting at 1 again
- **THEN** its heartbeats and events are stored and the box shows as up

### Requirement: Read API and live updates
The dashboard SHALL serve `GET /api/boxes` with every box, its state, and its sessions ordered by last activity, `GET /api/sessions/<id>/events?limit=<n>&before=<id>` with that session's prompts, replies, tool calls and results in storage order, newest last, each with its storage `id`, limited to `n` entries (default 200) and, when `before` is given, only entries stored before that id, so that older entries can be loaded page by page, and `GET /api/events` as a Server-Sent Events stream that sends an update whenever stored data changed, at most every 500 ms. The read API SHALL NOT require the ingest token.

#### Scenario: Live update
- **WHEN** a browser holds the SSE stream open and a box posts a batch
- **THEN** the browser receives an update event within one second

#### Scenario: Older entries
- **WHEN** a session has 500 events and the client requests `limit=200&before=<id of its oldest loaded entry>`
- **THEN** the response holds the 200 entries stored right before that id, newest last
