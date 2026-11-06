# Spec Delta

## MODIFIED Requirements

### Requirement: Cards
The web app SHALL show one card per box with, in this order: a header with status dot, phase, box name and permission mode; the mascot strip; a status box; a session block of four rows; a footer. The status box SHALL always be two text lines high and SHALL show the state in its color: green "Arbeitet" with the last tool call, amber "Wartet auf dich" with the elapsed time and the waiting tool, grey "Idle seit …" with the last tool call, grey "Session beendet" with its time, grey "Offline seit …" with the last heartbeat, grey "Noch keine Session", amber "Setup fehlt" with `docker compose exec -it <name> setup` (or, for `waiting-config`, the hint to check the logs), red "Startet neu". The session block SHALL always show the same four rows: the session's age (time since it started, plus "zuletzt" with day and time when the last activity was not today) and model; context size against the model's window; token totals, turns and tool calls; git branch with commits ahead and dirty file count. A row without data SHALL show a dash so that its height is kept. The footer SHALL always be present; without a session its controls SHALL be disabled. The session's first prompt SHALL NOT be shown as a heading; it stays in the timeline and as the session row's hover text. All cards SHALL have the same height at a given viewport width. Tapping the footer toggle SHALL expand the session's timeline (prompts, replies, tool calls with results) with the newest at the bottom. Cards SHALL stack in one column on screens narrower than 640 px and form a grid above. The app SHALL follow the device's light or dark mode.

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
- **WHEN** the user taps the timeline toggle of a card with a session
- **THEN** the card shows the session's recent prompts, replies and tool calls, and tapping again collapses it

#### Scenario: Phone layout
- **WHEN** the page is opened on a 390 px wide screen with three boxes
- **THEN** three cards appear one below the other, each readable without horizontal scrolling

#### Scenario: Session line
- **WHEN** a session started two hours ago and was last active ten minutes ago
- **THEN** the session row reads "seit 2 h" on the left and the model on the right, without the first prompt

#### Scenario: Older session
- **WHEN** a session's last activity was yesterday evening
- **THEN** the session row adds "zuletzt" with that day and time

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
