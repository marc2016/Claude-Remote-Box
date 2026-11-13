# Spec Delta

## MODIFIED Requirements

### Requirement: Session detail view
Tapping a card SHALL open a detail view for that box. The transition SHALL animate the card growing into the view where the browser supports view transitions and SHALL switch without animation elsewhere. The open box SHALL be reflected in the URL hash so that the browser's back navigation, the Escape key, and a close button all close the view, and opening the page with that hash opens the view directly. From 768 px viewport width up, the view SHALL show the card's information (header, mascot, status box, session rows, session link) on the left and the conversation on the right; below that width the information SHALL stand compactly on top and the conversation SHALL fill the remaining height. When the box has reported Git state, the information SHALL include a Git overview: from 768 px up, one line per checkout of the box, the workspace's own checkout first, with branch, unpushed and behind counts or the reason there are none ("nicht auf origin", "auf origin gelöscht"), and changed files, under a heading that shows the age of the last fetch or "nie" when the repository was never fetched; below 768 px, a single line with the number of checkouts that have unpushed commits, the number that are behind, and the age of the last fetch, which, when tapped, opens the same list of checkouts in a sheet over the conversation that closes with a close control, a tap outside, and the back navigation. The list SHALL carry the action controls, the action states, and the warnings described in `dashboard-git-actions`; the Git overview SHALL NOT change a repository in any other way. The conversation SHALL show the active session's entries newest last: prompts as user bubbles, replies as agent messages rendered from Markdown, tool calls as compact trace lines with the tool name and summary and a state of running, done, or error, and, while the session waits for the user, the pending tool line in the state "Freigabe ausstehend". The conversation SHALL update from the live stream without polling, SHALL keep the view at the bottom while the user is at the bottom and otherwise offer a control to jump to new entries, and SHALL load older entries on demand at the top. When the box has no session, the conversation area SHALL say so.

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

#### Scenario: Git sheet on a phone
- **WHEN** the user taps that line at 390 px
- **THEN** a sheet shows `main` with "3 hinter" and `feature/nav` with "2 nicht gepusht" together with their actions, without horizontal overflow, and the back navigation closes the sheet and leaves the detail view open

#### Scenario: No Git state
- **WHEN** the box's workspace is not a Git repository
- **THEN** the detail view shows no Git overview
