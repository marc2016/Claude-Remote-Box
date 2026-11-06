# Design

## Context

See proposal.md. The card (`BoxCard.tsx`) already derives everything needed: `SessionCard.state` (`working`, `idle`, `waiting`, `ended`), `BoxCard.up`, and the box phase. The activity line (`ActivityLine`) renders one row of text with an icon; it becomes part of the strip. The theme has `--color-warning`, `--color-muted-foreground`, and no accent orange yet.

## Goals / Non-Goals

**Goals:** legible at 24 px, zero layout shift, negligible battery cost, same look in light and dark.

**Non-Goals:** sprite sheets, Lottie, JavaScript-driven frames, per-tool poses.

## Decisions

### D1: Inline SVG on a 16×12 grid, parts as separate rects
`Clawd.tsx` renders an `<svg viewBox="0 0 16 12">` with `shape-rendering="crispEdges"`: body (two rects), two eye gaps drawn as background-colored rects, arm row, four legs as two pairs (`.leg-a`, `.leg-b`), plus optional props: `!` (two rects), `z z z` (three small rects), wrench (three rects), and `.eyes` for blinking. The whole figure is 16 units wide, rendered at 24 px height (32 px wide). Colors via `fill="currentColor"` on a wrapper with `text-[--color-clawd]`; `--color-clawd` is Claude orange `oklch(0.72 0.14 45)` in both themes, the asleep variant uses `text-muted-foreground`.
- *Alternative: a PNG sprite sheet.* Rejected: not themable, blurry at odd scales, an asset to maintain.

### D2: CSS keyframes per state, applied by a class on the stage
The stage is `<div class="clawd-stage" data-state="working">`; `index.css` holds:
- `walk`: `translateX(0) → translateX(calc(100% - 32px))`, 7 s, `alternate`, `linear`; a sibling `face` animation flips `scaleX` at the turn points with `steps(1)`.
- `step`: `.leg-a` and `.leg-b` alternate `translateY(0/-1px)` every 160 ms with `steps(2)`.
- `bob`: body `translateY` 0/−1 px in time with `step`.
- `breathe`: `scaleY(1 → 1.04)`, 3 s, `ease-in-out`, origin bottom.
- `blink`: `.eyes` `scaleY(1 → 0.1 → 1)` for 120 ms every 4 s.
- `bounce`: `translateY(0 → -4px)`, 0.6 s, `ease-out`, alternate; `pulse` on the `!`.
- `zzz`: three rects fade and rise with staggered delays, 2.4 s loop.
- `wrench`: small rotation, 1 s, alternate.
`@media (prefers-reduced-motion: reduce) { .clawd-stage * { animation: none } }`.
- The stage has a fixed height of 32 px and `overflow: hidden`; all motion is `transform`/`opacity`, so nothing reflows.

### D3: State mapping
```
box.up false            -> sleeping (grey)
phase waiting-setup/
      waiting-config    -> wrench
session none            -> sitting (idle pose), text "Noch keine Session"
session.state ended     -> sleeping (grey)
session.state waiting   -> waiting (!), alert stays as today below the strip
session.state working   -> walking
session.state idle      -> sitting
```
The text next to Clawd is the former `ActivityLine` content; for `waiting` the strip text is "wartet auf dich", the alert below keeps tool, summary and elapsed time.

### D4: Placement
The strip sits between the header and the session block (or the setup alert), left-aligned Clawd with the text to its right in a flex row; the walk animation uses the strip's full width (`calc(100% - 32px)`), so on a phone he walks ~300 px, on the desktop grid ~330 px. The former activity line is removed, so net card height grows by the strip height minus the line height, about 8 px.

## Risks / Trade-offs

- [Animations on a hidden tab keep running] → browsers throttle background tabs; CSS transforms on three small SVGs are below noise.
- [Pixel figure looks blurry at fractional device pixel ratios] → `crispEdges` and integer sizes (24 px high at 1x, 48 at 2x) keep edges sharp.
- [Walk width changes on resize mid-animation] → the keyframe uses a percentage, so the browser recomputes; a one-frame jump on rotate is acceptable.

## Migration Plan

Web app only; ships with the next dashboard image. No data or API change.

## Measurements

Playwright against the seed, 390 px wide, before and after (card heights in px):

| Card | State | Before | After | Delta |
| --- | --- | --- | --- | --- |
| looptalk | working | 232 | 236 | +4 |
| janus-note-vs | waiting | 294 | 330 | +36 |
| flashagenda | waiting-setup | 150 | 186 | +36 |

The working card stays within the 8 px budget. Cards that had no activity line before (waiting, setup) gain the whole strip plus the 12 px content gap; the strip was reduced from 32 to 24 px (figure 16 px, 8 px headroom for props) to keep that at +36. No horizontal overflow at 390 or 1280 px; with `reducedMotion: reduce` no element moves over two seconds, without it the walking Clawd's `left` changes. The sleeping pose rotates the figure with `transform-box: view-box` around the figure center; `fill-box` moved it out of the viewport in the first attempt. The exclamation mark sits beside the head (top right) rather than above it: with only four grid rows of headroom, the bounce pushed the body into it; the bounce is 3 px.

