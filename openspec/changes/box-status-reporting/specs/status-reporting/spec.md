# Spec Delta

## Purpose

Lets a box report its phase, its sessions, and what they are doing to a status endpoint the user runs, so that a dashboard can show every box at a glance without a Docker socket or access to the config directory.

## ADDED Requirements

### Requirement: Opt-in reporting through environment variables
Reporting SHALL be off unless `CRB_STATUS_URL` is set to an `http://` or `https://` URL. Every request SHALL carry `CRB_STATUS_TOKEN` as a bearer token; when the URL is set and the token is empty, the container SHALL log a warning once at start and send without a token. The box SHALL identify itself in every request by `CRB_NAME`.

#### Scenario: Not configured
- **WHEN** a container starts without `CRB_STATUS_URL`
- **THEN** no watcher process runs, nothing is sent, and the log does not mention status reporting

#### Scenario: Configured
- **WHEN** a container starts with `CRB_STATUS_URL=http://receiver:8080/api/ingest` and a token
- **THEN** within 5 s the receiver gets a request with header `Authorization: Bearer <token>` whose body names the box

### Requirement: Phase and heartbeat
The entrypoint SHALL report each phase change (`waiting-config`, `waiting-setup`, `running`, `restarting`) as an event, and while the container runs SHALL send a heartbeat at least every 30 s carrying the phase, the image version, the Claude Code version, the spawn mode, and the container uptime. A receiver that has not seen a heartbeat for 90 s MAY treat the box as down.

#### Scenario: Phase change
- **WHEN** setup completes and the container moves from `waiting-setup` to `running`
- **THEN** the receiver gets a `phase` event with `running` before the server starts

#### Scenario: Heartbeat cadence
- **WHEN** a configured container runs for two minutes without any session activity
- **THEN** the receiver gets at least four heartbeats

### Requirement: Session events from transcripts
The watcher SHALL detect every transcript Claude Code writes for sessions of this box, including sessions in git worktrees and subagent transcripts, and SHALL emit events from new transcript lines as they are appended, without modifying the transcripts. Events SHALL carry the session id, the box name, a timestamp, and a sequence number, and SHALL cover: session start (with cwd, git branch, Claude Code version, permission mode when present), user prompt (text, truncated), assistant text (truncated), tool call (tool name and a one-line input summary such as the command, the file path, or the pattern), tool result (ok or error), and session end when the server reports it or the transcript has been idle for an hour. Text fields SHALL be truncated to 4000 characters with a marker.

#### Scenario: Prompt and reply
- **WHEN** a user sends "Zeig mir die Startseite" and Claude answers with text after running one Bash command
- **THEN** the receiver gets, in order, a `prompt` event with that text, a `tool` event naming `Bash` and the command, a `tool_result` event with `ok`, and a `reply` event with the answer text

#### Scenario: Worktree session
- **WHEN** a session is spawned in a git worktree, so its transcript lives in another project directory under the config directory
- **THEN** its events arrive with the same box name and its own session id

#### Scenario: Long reply
- **WHEN** Claude's reply is longer than 4000 characters
- **THEN** the `reply` event carries the first 4000 characters and a truncation marker

### Requirement: Session summary
After each assistant message the watcher SHALL send a `summary` for that session with: model, cumulative input, output, cache-read and cache-write tokens, the context size of the last request (input plus cache tokens of that request), number of turns, number of tool calls, start time, last activity time, and, when the transcript provides them, cost in USD and lines added/removed. Fields the transcript does not provide SHALL be omitted, not zeroed.

#### Scenario: Totals grow
- **WHEN** a session has produced three assistant messages
- **THEN** the third `summary` reports the model, token totals equal to the sum of the three usages, and `turns` of 3

#### Scenario: Missing cost data
- **WHEN** the transcript format of the pinned Claude Code version carries no cost entries
- **THEN** the summary has no `cost_usd` field

### Requirement: Git state
When `/workspace` is a Git repository, the watcher SHALL send a `git` event with every heartbeat describing the main checkout and every worktree listed by `git worktree list`: path, branch, number of commits ahead of the repository's default branch, number of changed files in the working tree, lines added and removed against the default branch, and the subject and time of the last commit. The watcher SHALL only read; it SHALL NOT run any Git command that changes the repository. When `/workspace` is not a Git repository, no `git` event is sent.

#### Scenario: Worktree with commits
- **WHEN** a session's worktree has two commits on its branch and one modified file
- **THEN** the `git` event lists that worktree with `ahead: 2`, `dirty: 1`, its branch, and the last commit subject

#### Scenario: Not a repository
- **WHEN** `/workspace` holds a plain directory
- **THEN** heartbeats arrive without any `git` event

### Requirement: Waiting marker
When a tool call has no result for 10 s, the watcher SHALL send a `waiting` event for the session naming the tool and its summary; when the result arrives, it SHALL send a `resumed` event. If the image ships a permission-prompt hook, a hook-reported permission prompt SHALL produce a `waiting` event with `source: hook` immediately, and the heuristic event SHALL still follow if the result stays out.

#### Scenario: Long-running command
- **WHEN** a Bash call takes 30 s to finish
- **THEN** the receiver gets `waiting` after about 10 s and `resumed` when the result lands

### Requirement: Non-blocking delivery with spool
A send SHALL time out after 2 s and SHALL never delay a session or the server. Events that cannot be sent SHALL be appended to a spool file under `/tmp`, bounded to the newest 500 lines, and SHALL be resent in order before new events once the endpoint answers again. Heartbeats SHALL NOT be spooled.

#### Scenario: Endpoint down
- **WHEN** the endpoint is unreachable while a session produces 20 events, and comes back afterwards
- **THEN** the receiver gets those 20 events in order after it is back, and the session was not slowed down

#### Scenario: Spool bound
- **WHEN** the endpoint stays down while 700 events are produced
- **THEN** the spool holds the newest 500, and the log notes the loss once

### Requirement: Watcher supervision
The entrypoint SHALL start the watcher before the server and SHALL restart it with a delay when it exits, without affecting the server. A stop request SHALL end the watcher together with the server. The watcher SHALL NOT run when the container was started with an explicit command.

#### Scenario: Watcher crash
- **WHEN** the watcher process is killed while the server runs
- **THEN** the server keeps running, the watcher is back within 10 s, and the log notes the restart

#### Scenario: Stop
- **WHEN** the user runs `docker compose stop`
- **THEN** both processes end and the container stops within a few seconds
