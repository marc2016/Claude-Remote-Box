# Spec Delta

## MODIFIED Requirements

### Requirement: Box and session state
From the stored events the dashboard SHALL derive, per box: `up` while the last heartbeat is younger than 90 s and `down` otherwise, the current phase, image and Claude Code version, spawn mode, the permission mode of its sessions, and, from the latest `git` event, the list of the box's checkouts with branch, changed files, remote state, unpushed and behind counts, and the time of the last fetch; per session: name (session id, and the title or first prompt as label), model, token totals, context size, turns, tool calls, started and last-activity time, git state from the latest `git` event including the remote state of its checkout, and an activity state: `waiting` after a `waiting` event without a later `resumed`, `tool_result`, or `reply` (with the tool, summary, and waiting duration), `working` within 60 s of the last event, `idle` otherwise, `ended` after `session_end`. A `git` event without remote state, as sent by an older box, SHALL be accepted; the remote state is then unknown.

#### Scenario: Waiting shown
- **WHEN** a box reports `waiting` for `Bash npm test` and nothing after it
- **THEN** the card shows the session as waiting with "Bash: npm test" and the elapsed time, updated every few seconds

#### Scenario: Box down
- **WHEN** no heartbeat from a box arrived for more than 90 s
- **THEN** its card shows `down` with the time of the last heartbeat, keeping the last known phase and sessions

#### Scenario: Checkouts of a box
- **WHEN** a box reports a `git` event with the workspace on `main` and two worktrees, fetched five minutes ago
- **THEN** `GET /api/boxes` returns for that box the three checkouts with their remote state and the fetch time

#### Scenario: Older box
- **WHEN** a box reports a `git` event whose checkouts carry only branch, `ahead`, and `dirty`
- **THEN** the event is stored, the checkouts are returned with an unknown remote state, and the session's git row shows what it showed before this change

### Requirement: Cards
The web app SHALL show one card per box with, in this order: a header with status dot, phase, box name and permission mode; the mascot strip; a status box; a session block of four rows; a footer. The status box SHALL always be two text lines high and SHALL show the state in its color: green "Arbeitet" with the last tool call, amber "Wartet auf dich" with the elapsed time and the waiting tool, grey "Idle seit …" with the last tool call, grey "Session beendet" with its time, grey "Offline seit …" with the last heartbeat, grey "Noch keine Session", amber "Setup fehlt" with `docker compose exec -it <name> setup` (or, for `waiting-config`, the hint to check the logs), red "Startet neu". The session block SHALL always show the same four rows: the session's age (time since it started, plus "zuletzt" with day and time when the last activity was not today) and model; context size against the model's window; token totals, turns and tool calls; git branch with its push state and dirty file count. The push state SHALL read "n nicht gepusht" when the checkout has commits its remote counterpart lacks, "n hinter" when the counterpart has commits the checkout lacks, both when both apply, "nicht auf origin" when the branch has commits and no remote counterpart, "auf origin gelöscht" when its upstream is gone, and "gepusht" when it has a counterpart and neither applies; when the remote state is unknown the row SHALL show the commits ahead of the default branch as before. The git row SHALL stay on one line and truncate the branch name before the state. A row without data SHALL show a dash so that its height is kept. The footer SHALL always be present with the session link and an "Öffnen" control; without a session the session link SHALL be disabled. The session's first prompt SHALL NOT be shown as a heading; it stays in the conversation and as the session row's hover text. All cards SHALL have the same height at a given viewport width. The card SHALL NOT contain a collapsible timeline; tapping the card or its "Öffnen" control SHALL open the detail view. Cards SHALL stack in one column on screens narrower than 640 px and form a grid above. The app SHALL follow the device's light or dark mode.

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

#### Scenario: Unpushed work
- **WHEN** a session's checkout is on `feature/nav` with 2 commits its remote counterpart lacks and 1 changed file
- **THEN** the git row reads "feature/nav · 2 nicht gepusht · 1 geändert"

#### Scenario: Pushed
- **WHEN** a session's checkout equals its remote counterpart and has no changed files
- **THEN** the git row reads the branch name and "gepusht"

#### Scenario: Not on origin
- **WHEN** a session's branch has one commit and no remote counterpart
- **THEN** the git row reads the branch name and "nicht auf origin"

#### Scenario: Long branch name
- **WHEN** the branch name is 60 characters long at 390 px width
- **THEN** the name is truncated, the push state stays visible, and the card's height is unchanged

### Requirement: Session detail view
Tapping a card SHALL open a detail view for that box. The transition SHALL animate the card growing into the view where the browser supports view transitions and SHALL switch without animation elsewhere. The open box SHALL be reflected in the URL hash so that the browser's back navigation, the Escape key, and a close button all close the view, and opening the page with that hash opens the view directly. From 768 px viewport width up, the view SHALL show the card's information (header, mascot, status box, session rows, session link) on the left and the conversation on the right; below that width the information SHALL stand compactly on top and the conversation SHALL fill the remaining height. When the box has reported Git state, the information SHALL include a Git overview: from 768 px up, one line per checkout of the box, the workspace's own checkout first, with branch, unpushed and behind counts or the reason there are none ("nicht auf origin", "auf origin gelöscht"), and changed files, under a heading that shows the age of the last fetch or "nie" when the repository was never fetched; below 768 px, a single line with the number of checkouts that have unpushed commits, the number that are behind, and the age of the last fetch. The Git overview SHALL NOT offer any control that changes a repository. The conversation SHALL show the active session's entries newest last: prompts as user bubbles, replies as agent messages rendered from Markdown, tool calls as compact trace lines with the tool name and summary and a state of running, done, or error, and, while the session waits for the user, the pending tool line in the state "Freigabe ausstehend". The conversation SHALL update from the live stream without polling, SHALL keep the view at the bottom while the user is at the bottom and otherwise offer a control to jump to new entries, and SHALL load older entries on demand at the top. When the box has no session, the conversation area SHALL say so.

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

#### Scenario: Git overview on a wide screen
- **WHEN** the detail view of a box with `main` 3 behind and a worktree on `feature/nav` 2 unpushed, fetched 12 minutes ago, is shown at 1280 px
- **THEN** the information shows "Fetch vor 12 min" and two lines, `main` with "3 hinter" first and `feature/nav` with "2 nicht gepusht"

#### Scenario: Git overview on a phone
- **WHEN** the same view is shown at 390 px
- **THEN** one line reads that 1 checkout has unpushed commits, 1 is behind, and the fetch was 12 minutes ago, and the conversation keeps the remaining height

#### Scenario: No Git state
- **WHEN** the box's workspace is not a Git repository
- **THEN** the detail view shows no Git overview
