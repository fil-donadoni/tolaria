---
title: the rollout opponent spends its mana on upkeep self-buffs and never finds the pump-after-blocks line
discoveredBy: 6909
status: draft
confidence: high
---

**What is wrong.** Issue #6909's position, after the fix: the Bot (active, at 6)
attacks with its three small creatures and keeps only the 3/3 home. The
opponent's crackback is lethal only through a two-step line — buy trample on
its Mantle-enchanted 3/3, then pump it with the four red sources — and the
ε-greedy rollout policy never plays it. Traced with ε forced to zero
(`selectRolloutMove`, every move greedy): on the Bot's own declare-attackers
step the opponent activates Noble Panther's `{1}: first strike` seven times in
a row; on its own turn it spends every land at UPKEEP on first strike and
Mantle activations, plays its land, activates once more at beginning of
combat and declares `no attacks`. Over 30 seeded rollouts after that attack
the Bot dies in 0 and its median life is 6; after an all-in attack it dies in
8 and after the issue's Gorilla + Pilgrim attack its median life is 1, so the
tapped-aware and pump-aware reads landed where the opponent attacks at all.

**A second shape, same cause.** After the Bot's ALL-IN attack (no blocker
left at all), the same greedy trace has the opponent attack with the pumped
Panther alone, for five: the Battlemage and the Elf stay home because the
leaf prices the three extra face points linearly (`facePrice`, 8 a point)
below the clock exposure of tapping its last two blockers, and nothing
pre-block reads "six is the Bot's whole life" (`lethalUnblockedDelta` fires
only on confirmed blocks, by design). So an all-in into a six-power crackback
dies in 8 of 30 playouts, not 30, and in the no-red-source twin of the
position the search swings all-in on one seed.

**Evidence.** `convex/gre/search.ts` `selectRolloutMove` (1-ply policy): a
transient self-buff outside combat scores above `pass` because the leaf prices
the granted keyword / effective power and only discounts the tapped land, so
mana is burned before combat; and the trample-then-pump line is a plateau —
the first step (trample on a blocked 3/3 into a 3/3) gains nothing at one ply.
`convex/gre/dangerClock.ts` `predictCombatOutcome` reads neither first strike
nor a trample grant for the pre-block prediction, so the pumped attacker is
still a trade in the opponent's declare-attackers probe.

**Why it may not deserve its own issue.** The class is "the rollout policy
cannot execute a multi-step combat line", which ADR 0015's turn-boundary
rollout accepts by design and the root rules deliberately do not patch (ADR
0124 §5). It may belong as a line on the bot AI map (issue #1254) rather than a
ticket, unless a Verdict corpus shows the upkeep-self-buff waste is common.
