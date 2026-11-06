# Tasks

## 1. Card

- [x] 1.1 Replace the label in the session line of `BoxCard.tsx` with the age and the conditional "zuletzt" (D1), keeping the model on the right and the first prompt as `title`. Verify with the seed in the browser: the working card reads "seit …", the `archiv` card (seeded with yesterday's timestamps) reads "seit … · zuletzt …", no card shows its first prompt in the line.
- [x] 1.2 Screenshot check at 390 px: card heights unchanged against the `card-mascot` measurements and no horizontal overflow; `npm run typecheck` and `npm run build` pass.
