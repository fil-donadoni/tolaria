---
title: TargetSelectionBanner's Done button ignores minReached
discoveredBy: 2365
status: draft
confidence: medium
---

**What is wrong.** `src/components/board/target-selection-banner.tsx:88`:

```ts
const showDone = typeof pendingTarget.count !== "number" && !maxReached;
```

`showDone` never consults `describeTargetProgress`'s `minReached`. For a range
requirement with `min > 0` (e.g. `{ min: 2, max: 4 }` — "choose two or three
target creatures"), the Done button is offered as soon as ANY target is
selected, below `min`. Clicking it calls `confirmTargets`, which throws "At
least 2 target(s) required" server-side (`convex/gre/state.ts`/`game.ts`'s
`confirmTargets` handler) — a dead click with no user-visible error surfaced
by the mutation call site.

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
