---
title: The ISMCTS coarse leaf models every shock land as entering untapped for free
discoveredBy: 1980
status: draft
confidence: medium
---

**What is wrong.** The two Bot leaves disagree about shock lands.
`applyMoveForSearch` (the greedy 1-ply sandbox) routes `play-land` through the
real `applyPlayLandFromAnyZone`, so a shock land suspends on the CR 614.12
pay-choice and `autoFinalizeLandEntryChoices` drains it with the ADR 0016
default (pay iff affordable). `applyMoveInSearch` (the ISMCTS tree leaf) does
its own inline zone move instead, so the land enters **untapped and free** —
the search never sees the 2 life, and never sees the tapped land it would get
at low life.

**Evidence.** `convex/gre/search.ts:630-676` — the `play-land` case calls
`moveCard` + `emitPermanentEntered` directly and never touches
`applyPlayLand*`, `enqueueLandEntryChoice` or `finalizeLandEntry`. Compare
`convex/gre/applyMove.ts:647-660`, which calls `applyPlayLandFromAnyZone` and
then `autoFinalizeLandEntryChoices(next)` precisely so the rollout cannot
stall. The divergence predates #1980 and is unchanged by it; #1980 only
widened which origins reach the choice at all.

**Why it may not deserve its own issue.** The coarse leaf is deliberately
coarse (its own header says so — it also models mana approximately), and 2 life
inside a rollout horizon is small next to what that leaf already abstracts
away. It matters only for a deck where the tapped/untapped bit decides a turn,
and the honest fix is either routing the leaf through the shared primitive
(paying the cost the leaf exists to avoid) or a flat life adjustment, which is
a bot-evaluation judgement call rather than a correctness bug.
