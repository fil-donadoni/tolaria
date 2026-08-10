---
title: TargetSelectionBanner shows a disabled Done button below min
discoveredBy: 2365
status: draft
confidence: low
---

**What is wrong.** `src/components/board/target-selection-banner.tsx:88`:

```ts
const showDone = typeof pendingTarget.count !== "number" && !maxReached;
```

`showDone` never consults `describeTargetProgress`'s `minReached`. For a range
requirement with `min > 0` (e.g. `{ min: 2, max: 4 }` — "choose two or three
target creatures"), the Done button is RENDERED as soon as the banner opens,
below `min`.

**This is cosmetic, not a dead click.** `minReached` _is_ consulted — one line
down, on the button's `disabled` prop (`:142`,
`disabled={isBusy || !minReached}`), not on `showDone`. So the button appears
early but is unclickable, and `confirmTargets` is never reached below `min`.
The defect is that a disabled control is shown where it could simply be
hidden.

**Why it wasn't fixed in #2365.** This bug is pre-existing, not introduced by
that PR: any positive-`min` range requirement already hits it, with or without
the `max: "X"` widening the issue added. It is also NOT triggered by the
`{min: 0, max: X}` "up to X" template #2365 ships (the motivating case),
since `minReached` is trivially true at `min: 0` — so the PR's own feature
ships correct, and fixing this pre-existing gap was out of the fixup's scope
per review (finding 5, PR #2443).

**Evidence.** `describeTargetProgress` (`src/lib/target-progress.ts`) already
computes `minReached` — `TargetSelectionBanner` just doesn't read it before
deciding to render Done. The fix is one line:
`const showDone = typeof pendingTarget.count !== "number" && minReached && !maxReached;`
— plus a component test asserting Done is withheld until `min` selections
are made for a `{min: 2, ...}` requirement.

**Why it may not deserve its own issue.** No shipped card uses a targeted
ability with `min > 1` and a UI path that reaches this banner without also
auto-finalizing before the user could click Done in a way that's been
observed as a live bug report; scope + a regression test is small enough to
fold into whatever ships the next `min > 1` targeted card, or a standalone
"fix + test" pass if a human wants it sooner.
