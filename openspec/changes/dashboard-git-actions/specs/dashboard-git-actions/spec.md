# Spec Delta

## Purpose

Lets the signed-in user trigger Git actions for a box from the dashboard, which queues them for the host agent and shows what became of them, and warns when a session's branch has fallen behind the default branch or when the agent is absent.

## ADDED Requirements

### Requirement: Queuing an action
The dashboard SHALL accept `POST /api/git/actions` with a JSON body naming a box, a kind, and what the kind needs: `fetch` and `sync` nothing more; `push`, `pull`, and `merge` a `branch`; `branch` a `name` and optionally `carry`. It SHALL answer `202` with the action's id and store the action as queued. It SHALL answer `400` and store nothing when the box is unknown, the kind is none of these six, or a branch or name is longer than 100 characters, starts with `-`, or contains anything but letters, digits, `.`, `_`, `/`, and `-`. An action equal to one that is still queued or running SHALL NOT be stored again; the answer SHALL carry the id of the existing one. With 20 actions queued or running the dashboard SHALL answer `429`. The dashboard SHALL NOT run Git itself, and its service SHALL keep exactly one mount, its data volume.

#### Scenario: Push queued
- **WHEN** a signed-in user posts kind `push`, box `flashagenda`, branch `calm-clock`
- **THEN** the answer is `202` with an id, and the action is listed as queued

#### Scenario: Same action twice
- **WHEN** the same push is posted again while the first is queued
- **THEN** the answer carries the first id and one action is stored

#### Scenario: Bad name
- **WHEN** kind `branch` is posted with the name `x; rm -rf /`
- **THEN** the answer is `400` and nothing is stored

#### Scenario: Unknown box
- **WHEN** an action names a box the dashboard has never heard from
- **THEN** the answer is `400` and nothing is stored

### Requirement: Who may queue
Queuing SHALL require a valid session, a request that comes from the page at the public address, and a passkey confirmation of that session that is at most ten minutes old. Without a session the answer SHALL be `401`. With a session whose confirmation is older the answer SHALL be `403` with a marker the page can tell from other refusals; the page SHALL then ask for the passkey, and after a successful confirmation queue the action without the user repeating the request. A passkey sign-in by a browser that is already signed in SHALL count as that confirmation and SHALL leave the browser with one valid session. With `CRB_DASHBOARD_AUTH=off` queuing SHALL be refused with `403`, the page SHALL offer no action, and the documentation SHALL say that actions need the login. While the agent is absent, as defined below, queuing SHALL be answered with `503`.

#### Scenario: Not signed in
- **WHEN** an action is posted without a session cookie
- **THEN** the answer is `401` and nothing is stored

#### Scenario: Confirmation needed
- **WHEN** a user who signed in two hours ago taps "pushen" and confirms with Face ID
- **THEN** the push is queued, and the user stays signed in with one session

#### Scenario: Confirmation dismissed
- **WHEN** the user dismisses the passkey dialog
- **THEN** nothing is queued and the page says that the action was not confirmed

#### Scenario: Another site
- **WHEN** the request carries an `Origin` other than the public address
- **THEN** the answer is `403` and nothing is stored

#### Scenario: Login off
- **WHEN** the dashboard runs with `CRB_DASHBOARD_AUTH=off`
- **THEN** posting an action is answered with `403` and the page shows no action control

### Requirement: Agent access
The dashboard SHALL offer the host agent one way to collect the next queued action and one way to report an outcome, both authenticated with `Authorization: Bearer <CRB_AGENT_TOKEN>`. It SHALL answer `401` for any other value, including `CRB_STATUS_TOKEN`, and for every request while its own agent token is empty. It SHALL refuse with `403` a request to these two that carries an `X-Forwarded-For` or `Forwarded` header, so that they cannot be reached through the reverse proxy. Collecting SHALL hand out each action once, the oldest queued one first, and SHALL mark it as running. A request to collect MAY be held open for up to 25 seconds while nothing is queued. Neither way SHALL be usable with a session cookie.

#### Scenario: Collected once
- **WHEN** one action is queued and the agent collects twice
- **THEN** the first request returns the action and the second returns none

#### Scenario: A box tries
- **WHEN** a request to collect carries the boxes' status token
- **THEN** the answer is `401` and the action stays queued

#### Scenario: Through the proxy
- **WHEN** a request to collect arrives with `X-Forwarded-For` and the right token
- **THEN** the answer is `403`

#### Scenario: No agent token configured
- **WHEN** the dashboard runs without `CRB_AGENT_TOKEN`
- **THEN** every request to collect or report is answered with `401`

### Requirement: Life of an action
An action SHALL be in exactly one of the states queued, running, done, refused, failed, or expired. A queued action that was not collected within two minutes SHALL become expired and SHALL never be handed out. A running action without a reported outcome after ten minutes SHALL become failed with a text saying that the host did not answer. An outcome SHALL be accepted once, for a running action only. The dashboard SHALL serve `GET /api/git` to a signed-in browser with the agent's state and the 50 most recent actions, each with box, kind, branch or name, state, the times it was queued and finished, and the text the agent reported; without a session it SHALL answer `401`. A change of an action's state SHALL reach open pages through the live stream within two seconds. Actions SHALL be removed after seven days.

#### Scenario: Result arrives
- **WHEN** the agent reports `done` with the text "✓ calm-clock 2 gepusht"
- **THEN** `GET /api/git` lists the action as done with that text, and an open page shows it without a reload

#### Scenario: Agent stopped before collecting
- **WHEN** an action is queued and no agent collects it for two minutes
- **THEN** it is listed as expired, and an agent started afterwards does not carry it out

#### Scenario: Agent died while running
- **WHEN** an action was collected and no outcome arrives for ten minutes
- **THEN** it is listed as failed with the text that the host did not answer

#### Scenario: Outcome reported twice
- **WHEN** a second outcome is reported for an action that is done
- **THEN** it is rejected and the stored outcome is unchanged

### Requirement: Agent state
The dashboard SHALL treat the agent as present while its last request to collect is younger than 90 seconds, and as absent otherwise. `GET /api/git` SHALL carry whether an agent was ever seen, whether it is present, and the time of its last request. While the agent is absent after having been seen, the page SHALL show, above the cards, that the host agent does not answer, with the command `./crb agent status`, and SHALL offer no action. When no agent was ever seen, the page SHALL show no such notice on the card list and SHALL show, in place of the actions in the detail view, that actions need the host agent and the command `./crb agent install`.

#### Scenario: Agent stops
- **WHEN** the agent stops and 90 seconds pass
- **THEN** the page shows the notice with `./crb agent status`, no action control is offered, and posting an action is answered with `503`

#### Scenario: Agent returns
- **WHEN** the agent starts again
- **THEN** the notice disappears and the actions are offered again without a reload

#### Scenario: Never installed
- **WHEN** a dashboard has never been contacted by an agent
- **THEN** the card list has no notice, and the detail view names `./crb agent install` where the actions would be

### Requirement: Action controls
The detail view of a box SHALL offer, in the list of checkouts of its Git overview (shown in place from 768 px up and in the sheet below that, as described in `status-dashboard`): for the box, "Jetzt abrufen" (fetch), "Synchronisieren" (sync), and "Neuer Branch"; and for each checkout, the actions its reported state allows: "pushen" when it has commits that are not on its remote counterpart and is not behind it, or has no counterpart and commits of its own; "holen" when it is behind and has no unpushed commits; and "nach <default branch> mergen" when its branch is not the default branch and it has commits that the default branch lacks. A checkout that is ahead and behind SHALL show that it has diverged and that this is resolved with `./crb git` on the host, without an action. Every action except fetch SHALL ask for confirmation in a dialog before it is queued. The dialog for a merge SHALL name the branch, the default branch, and the number of commits, SHALL say that the result is pushed at once, and SHALL say, when the checkout has changed files, that uncommitted changes are not included. The dialog for a new branch SHALL ask for the name, SHALL reject a name the dashboard would not accept before sending it, SHALL offer to take the commits along, selected by default, exactly when the workspace's own checkout is on the default branch with commits that are not on `origin`, and SHALL say that the workspace's files change when a session is active in that checkout and the commits are not taken along. While an action for a checkout or box is queued or running, its controls SHALL be replaced by that state. A finished action SHALL be shown with its outcome and the agent's text until the user dismisses it or a newer action for the same box finishes; a refused or failed one SHALL be told apart from a done one by more than color. After an action has finished and until the box has reported again, for at most one minute, the list SHALL offer no action and SHALL say that the new state is on its way, because the checkouts shown are still those from before the action. Controls SHALL be at least 44 px high below 768 px, and the list SHALL NOT scroll horizontally at 360 px.

#### Scenario: Push from the phone
- **WHEN** a checkout shows "2 nicht gepusht", the user taps "pushen" and confirms
- **THEN** the row shows that the action is queued and then running, then the result with "✓ calm-clock 2 gepusht" and no action control, and after the box's next report the row shows "gepusht" and the controls return

#### Scenario: Merge dialog
- **WHEN** the user taps "nach main mergen" for `calm-clock` with 3 commits ahead of `main` and 2 changed files
- **THEN** the dialog names `calm-clock`, `main`, and 3 commits, says that `main` is pushed at once, and says that 2 uncommitted changes are not included

#### Scenario: Refused merge
- **WHEN** the agent refuses a merge because of a conflict
- **THEN** the row shows the refusal with the conflicting file names, marked with an icon and the word "abgelehnt"

#### Scenario: New branch with commits on main
- **WHEN** the workspace is on `main` with 2 unpushed commits and the user opens "Neuer Branch"
- **THEN** the dialog offers "2 Commits von main mitnehmen", selected

#### Scenario: New branch under a running session
- **WHEN** a session is working in the workspace's own checkout and the commits are not taken along
- **THEN** the dialog says that the files under that session change

#### Scenario: Diverged
- **WHEN** a checkout is 1 ahead and 1 behind
- **THEN** its row has no action and names `./crb git`

#### Scenario: Declined
- **WHEN** the user closes a confirmation dialog without confirming
- **THEN** nothing is queued

### Requirement: Warning for a branch behind the default branch
When the checkout of a card's session is on a branch other than the default branch and lacks commits of the default branch, the card's git row SHALL show "N hinter <default branch>" in the warning color together with a warning icon, before the other parts of the state, and the row SHALL still stay on one line. The Git overview of the detail view SHALL show the same for every such checkout. A box that does not report the distance SHALL show no warning. The warning SHALL NOT offer an action; the detail view SHALL say that the session brings its branch up to date.

#### Scenario: Stale session branch
- **WHEN** a session's checkout reports `behind_default: 12` on the branch `calm-clock` with the default branch `main`
- **THEN** the card's git row shows "12 hinter main" with the warning icon before "2 nicht gepusht"

#### Scenario: On the default branch
- **WHEN** the session's checkout is on `main` and 3 commits behind `origin/main`
- **THEN** the row shows "3 hinter" as before and no warning

#### Scenario: Older box
- **WHEN** a box's `git` event has no `behind_default`
- **THEN** its card shows no warning and no error
