---
title: The scenario builder's per-turn reset is a denylist that grows one field per issue
discoveredBy: 3446
status: draft
confidence: medium
---

**What is wrong.** `buildStateFromScenario` (`convex/gre/scenarioBuilder.ts`)
resets the loaded game's per-turn player tallies by NAMING them one at a time:
`drawnThisTurn` and `leftGraveyardThisTurn` (issue #3240), and now
`landsPlayedThisTurn` (issue #3446). Every other per-turn field on
`PlayerState` still leaks from whatever game `debugSetupScenario` was pointed
at — `spellsCastThisTurn` (CR 601.2i), `spellsWarpedThisTurn` (CR 702.185c),
`hasDrawnFromEmpty`, `skipNextTurn`, `leftGraveyardThisTurn`'s neighbours — so
the same spec can rebuild two different positions depending on the row it lands
in. A scenario PLACES a position; a denylist makes that promise only for the
fields someone has already been bitten by.

**Evidence.** `convex/gre/scenarioBuilder.ts` (the `p1./p2.<tally> = undefined`
block); the tallies `advanceTurn` resets are enumerated in
`convex/gre/phases.ts` (CR 305.2 / 601.2i / 702.185c reset loop) and are
strictly more than the three the builder clears. `buildBladeLoadState`
(`convex/gre/ai/blade/runner.ts`) argues the same point for its own base state
and inverts it: blade always builds from `buildBladeBaseState()`, so it has no
live state to leak. The class fix is to make `debugSetupScenario` do likewise
(or drive the clear off an allowlist of what the spec expresses) rather than to
add a fourth name.

**Why it may not deserve its own issue.** Only the fields a spec can pin have
ever been observed to matter, and each widening under PRD #3397 clears its own
as it lands — so the leak is being retired incrementally anyway. It earns a
ticket only if a scenario is ever seen to rebuild differently in two
deployments, or if the PRD's remaining widenings make the list long enough that
the inversion is cheaper than the next three additions.

**Update (issue #3453).** The denylist is now nine names — issue #3453 added
its own five game-level tallies plus `abilityResolutionCounts`,
`lastKnownCopiable` and `cleanupBookkeepingTurn` — and one exception has
appeared that the paragraph above did not anticipate: issue #3449's three cast
tallies (`GameState.spellsCastThisTurn`, the per-seat
`spellsCastThisTurn`/`spellsCastThisGame`) are the only widened fields that do
NOT clear. That issue chose "absent means unchanged" and pinned it in a test
("leaves all three alone when the spec omits them",
`convex/gre/__tests__/scenarioBuilder.test.ts`), which is lossless for a
CAPTURED spec — `specFromState` lowers all three unconditionally — and leaky
for a HAND-WRITTEN or LLM-generated one, whose own generator prompt says to
emit them "ONLY when the description actually calls for them"
(`convex/debugScenarioGenerator.core.ts`). Loaded mid-turn through
`debugSetupScenario`, such a spec inherits the live game's storm count
(CR 702.40a — every storm spell on the staged board copies itself) and the
live seats' lifetime cast tallies, which gate Once Upon a Time's free cast
(CR 118.9) and therefore LEGALITY.

That is the first case where the two conventions disagree about the same
family of field, so the inversion this note proposes — drive the clear off an
allowlist of what the spec expresses, or build `debugSetupScenario` from a
fresh base the way `buildBladeLoadState` does — is now cheaper than keeping
them reconciled by hand.
