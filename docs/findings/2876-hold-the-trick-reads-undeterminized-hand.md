---
title: The hold-the-trick and last-window-fire rules read the un-determinized opponent hand, exactly as the block tie-break did
discoveredBy: 2876
status: draft
confidence: medium
---

**What is wrong.** Issue #2876 fixed ONE root consumer of hidden information —
`selectRootMove`'s block-quality tie-break, which ranked candidate blocks by
`blockDeltaOf(rootState, …)` and so read an opponent hand that on the wire is
opaque placeholders. It is not the only one. `firingBeatsHolding` reaches
`cautiousBlockPenalty` through `policyValue`'s `+ declaredBlockDelta`, and both
of its call sites pass `rootState`. Same class, same blindness: a hold decision
prices a combat as if the attacker held nothing castable.

**Evidence.** `convex/gre/search.ts:4200` and `:4262` call
`firingBeatsHolding(rootState, …)`; `policyValue` (`convex/gre/search.ts:1947`)
sums `evaluate` with `declaredBlockDelta`, whose `cautiousBlockPenalty`
(`convex/gre/evaluate.ts:1645`) calls `castableHeldInteraction(attacker)` — a
read of the ATTACKER's hand. Every other root probe was checked and is clean:
`isWastefulAttack`, `castVariantScore`, `extraTurnRewardCredit`,
`isSorcerySpeedTrickDump`, `isFreeManaSourceCast` / `isManaDorkCast` and the
dominance prune read only the bot's own hand or public zones.

`makeBlockDeltaLens` (issue #2876) does not generalise to it as written: the
lens prices a MOVE, and `policyValue` needs a whole-world lens — an average of
`policyValue(world, …)` over the sampled worlds, which is a different and
markedly more expensive shape (a full `evaluate` per world per candidate).

**Why it may not deserve its own issue.** The support is much narrower than the
block tie-break's: both sites are gated on an empty stack, and the hold rule
additionally excludes a source in a pending combat exchange, so the overlap with
"a block is being valued" is small. It may be better as a line on the
hidden-information tracker than a ticket of its own — and it is only worth
paying for at all if a measured position shows the hold rule actually turning on
the caution term.
