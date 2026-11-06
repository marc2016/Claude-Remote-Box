# Spec Delta

## ADDED Requirements

### Requirement: Mascot on the card
Each card SHALL show a strip above the session block with a small pixel Clawd whose pose and motion follow the state: `working` walks back and forth across the strip, turning at the edges; `idle` sits with half-closed eyes, breathes slowly and blinks now and then; `waiting` stands with wide eyes and a pulsing exclamation mark and bounces in place; `ended` and an offline box lie down in a muted color with rising "z z z"; `waiting-setup` and `waiting-config` stand still holding a wrench. The activity text ("arbeitet", "idle seit …", "Box offline", the setup hint) SHALL stand in the strip next to the mascot, so the card is not taller than before. The strip SHALL NOT exceed 36 px in height. Animations SHALL be CSS-driven, SHALL not change the card's layout while running, and SHALL stop (static pose) when the device prefers reduced motion. The mascot SHALL use the theme's accent color when active and the muted foreground color when asleep.

#### Scenario: Working session
- **WHEN** a session is `working`
- **THEN** Clawd walks across the strip, legs alternating, and turns around at the edges without leaving the card

#### Scenario: Waiting session
- **WHEN** a session is `waiting`
- **THEN** Clawd bounces in place with an exclamation mark, and the waiting alert stays the most prominent element of the card

#### Scenario: Offline box
- **WHEN** a box is down or its session has ended
- **THEN** Clawd lies down in grey with "z z z" and nothing else on the card moves

#### Scenario: Reduced motion
- **WHEN** the device reports `prefers-reduced-motion: reduce`
- **THEN** each pose is shown without animation

#### Scenario: No extra height
- **WHEN** a card with a working session is compared with the card before this change at 390 px width
- **THEN** its height differs by at most 8 px
