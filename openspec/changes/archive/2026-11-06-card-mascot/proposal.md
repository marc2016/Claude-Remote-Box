# Proposal

## Why

The cards tell the state of a box in words and badges. A small animated Clawd on each card makes that state readable from across the room and gives the page the character the terminal banner already has: walking while Claude works, resting while the session idles, jumping when it waits for the user, asleep when the box is offline.

## What Changes

- Each card gets a stage: a strip above the session block, about 32 px high, in which a pixel Clawd (inline SVG on a 16×12 grid) acts out the session's state: `working` walks back and forth across the strip, `idle` sits and breathes with an occasional blink, `waiting` stands and bounces with a pulsing "!", `ended` and an offline box lie down in grey with rising "z z z", `waiting-setup`/`waiting-config` stand still holding a wrench.
- The activity line ("arbeitet", "idle seit 40 min", "Box offline") moves into the strip next to Clawd, so the card does not grow.
- Animations are CSS keyframes only; with `prefers-reduced-motion` the pose is shown without movement. Colors follow the theme: Claude orange when active, muted grey when asleep.

Out of scope: a mascot for the page header or the empty state, sound, per-tool poses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `status-dashboard`: the card gains the mascot strip and its state mapping. This capability is a delta in the in-flight change `status-dashboard`; this change is archived after it.

## Impact

- `dashboard/web/src/components/Clawd.tsx` (new), `BoxCard.tsx` (strip replaces the activity line), `index.css` (keyframes, reduced-motion rule).
- `seed.mjs` already produces every state; the visual check reuses the Playwright screenshots.
- No server, API, or `crb` change.
