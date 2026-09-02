---
title: finalizeTargetSelection's mana-park branch drops `evoked` while carrying `dashed` and `bestowed`
discoveredBy: 2796
status: draft
confidence: medium
---

**What is wrong.** The real mutation path stamps a cast's mode markers onto
`PendingCast` at two sibling sites, and they disagree. The immediate-commit
branch carries `isEvokeCost` (`convex/game.ts:7202`); the branch that PARKS the
cast waiting for mana (`finalizeTargetSelection`, `convex/game.ts:7268`) spreads
`dashed` and `bestowed` and drops `evoked`. `tryAutoCommitPendingCast`
(`convex/game.ts:3633`) then reads `state.pendingCast.evoked` as absent, so
`evokeTrigger`'s `conditionOnSelf: self.evoked === true`
(`convex/cards/abilities/evoke.ts:52`) decides false and the permanent is never
sacrificed — CR 702.74a's whole point, skipped, in a **real game** rather than
in a search sandbox.

**Evidence.** `convex/game.ts:7202` vs `convex/game.ts:7268` — the same set of
markers, one of them missing from the second spread. Reachability needs an evoke
card with a **spell-level** `targetRequirement` cast while the mana is not yet
floating; all eight shipped evoke cards put their targeting inside a
`triggeredAbilities` entry, so nothing reaches it today. Surfaced while
extracting the search-side equivalent into `convex/gre/castMode.ts` for issue
#2796; that census deliberately covers the two SEARCH executors only, because the
commit paths read their answers off `PendingCast` rather than off
`Move.alternativeCostId` — so it does not close this one.

**Why it may not deserve its own issue.** Unreachable with the current
catalogue, and it may be cheaper to fix as part of giving the commit paths the
same census treatment (one shape reading `PendingCast`, one reading a Move) than
as a one-line spread fix that leaves the third and fourth copies of the list in
place. If it stays unreachable it is a line on whatever tracker owns the
"build-a-StackItem-from-a-cast" duplication (issue #2473's family), not a ticket.
