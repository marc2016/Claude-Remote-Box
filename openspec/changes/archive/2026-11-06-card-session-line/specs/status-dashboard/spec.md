# Spec Delta

## MODIFIED Requirements

### Requirement: Cards
The web app SHALL show one card per box with: status dot and phase, box name, permission mode, the active session's age (time since it started) and model, the activity state with its detail, context size against the model's window where known, token totals, git branch with commits ahead and dirty file count when reported, and a link to the session in the Claude app. When the session's last activity was not on the current day, the session line SHALL also show that time. The session's first prompt SHALL NOT be shown as a heading; it stays in the timeline and as the line's hover text. Waiting SHALL be the most prominent element of a card. A box in `waiting-setup` or `waiting-config` SHALL show the command to run instead of a session. Tapping a card SHALL expand the session's timeline (prompts, replies, tool calls with results) with the newest at the bottom. Cards SHALL stack in one column on screens narrower than 640 px and form a grid above. The app SHALL follow the device's light or dark mode.

#### Scenario: Phone layout
- **WHEN** the page is opened on a 390 px wide screen with three boxes
- **THEN** three cards appear one below the other, each readable without horizontal scrolling

#### Scenario: Expand
- **WHEN** the user taps a card with an active session
- **THEN** the card shows the session's recent prompts, replies and tool calls, and tapping again collapses it

#### Scenario: Setup pending
- **WHEN** a box reports phase `waiting-setup`
- **THEN** its card shows `docker compose exec -it <name> setup` instead of a session

#### Scenario: Session line
- **WHEN** a session started two hours ago and was last active ten minutes ago
- **THEN** the session line reads "seit 2 h" on the left and the model on the right, without the first prompt

#### Scenario: Older session
- **WHEN** a session's last activity was yesterday evening
- **THEN** the session line adds "zuletzt" with that day and time
