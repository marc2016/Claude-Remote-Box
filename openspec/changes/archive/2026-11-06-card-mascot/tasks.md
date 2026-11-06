# Tasks

## 1. Mascot component

- [x] 1.1 Create `dashboard/web/src/components/Clawd.tsx` (D1): the 16×12 figure as rects with classes for legs, eyes, and props, a `pose` prop (`walk`, `sit`, `wait`, `sleep`, `wrench`), accent color token `--color-clawd` in `index.css` for both themes. Verify in the browser with the seed that each pose renders crisp at 24 px in light and dark.
- [x] 1.2 Add the keyframes and the stage class to `index.css` (D2), including the reduced-motion rule. Verify with Playwright that in the working card the figure's `transform` changes over two seconds, that with `reducedMotion: 'reduce'` it does not, and that the stage's bounding box stays 32 px high.

## 2. Card integration

- [x] 2.1 Replace `ActivityLine` in `BoxCard.tsx` with the stage (D3, D4): Clawd left, the activity text right, mapping from box/session state. Verify with the seed: `janus-note-vs` bounces with "!" and keeps its alert, `looptalk` walks, `flashagenda` holds the wrench, and a box with an old heartbeat (seed stopped for two minutes) sleeps in grey.
- [x] 2.2 Screenshot check at 390 px and 1280 px, light and dark, against the previous build: no horizontal overflow, card height within 8 px of before. Record the measured heights in design.md.
