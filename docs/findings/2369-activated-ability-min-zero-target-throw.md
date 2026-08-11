---
title: activateAbility has the same min-0-target unconditional-throw shape announceCast just had
discoveredBy: 2369
status: draft
confidence: medium
---

**What is wrong.** The PR #2455 review (issue #2369) found `announceCast`
(`convex/game.ts`, around what is now line 7103) threw `"No legal targets
available"` for a `{ min: 0, max }` target requirement whenever
`getLegalTargets` returned zero candidates, even though the requirement's own
minimum was zero — CR 601.2c makes a min-0 "up to X" / "up to N" requirement
legal to announce with no targets chosen. The fix reorders the check so
`minTargetCount(resolvedCount)` is resolved before deciding whether an empty
legal-target set is fatal.

The activated-ability cast path has the identical shape and was not touched by
this fix.

**Evidence.** `convex/game.ts:12701-12703` (line numbers as of this PR):

```ts
if (legal.length === 0) {
    throw new Error("No legal targets available");
}
let abilityCount = resolveTargetCount(effectiveTargetReq.count, targetChosenX);
```

`abilityRequired` (`minTargetCount(abilityCount)`) is computed AFTER this
throw, exactly the ordering `announceCast` had before the fix — so an
activated ability with `count: { min: 0, max: ... }` and zero legal targets on
the board would hit the same false "No legal targets available" error.

**Why it may not deserve its own issue yet.** No shipped card currently
defines an `activatedAbilities[]` entry with an object-shaped `count` whose
`min` is `0` — grep for `divideAsChosen` / `min: 0` inside
`activatedAbilities` across `convex/cards/sets/**` turned up nothing at the
time of this PR, so the bug is latent, not reachable by any real card today.
It becomes live the first time a card ships an "activate: destroy up to N
target …" ability. Worth a narrow fixup (mirror the `announceCast` reorder at
this site) the next time such a card is added, or proactively as a small
follow-up mirroring this PR's change — scoping it into #2369 itself would have
widened the PR beyond its own review findings.
