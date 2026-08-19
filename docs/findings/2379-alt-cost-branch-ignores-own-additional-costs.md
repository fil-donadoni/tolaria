---
title: announceCast's alternative-cost branch ignores the card's own additionalCosts entirely
discoveredBy: 2379
status: draft
confidence: medium
---

**What is wrong.** When a cast names an `alternativeCostId` (CR 118.9),
`announceCast` takes a dedicated branch that builds its cost pickers from the
CHOSEN ALTERNATIVE COST only. The card's own `CardDefinition.additionalCosts`
— a CR 118.8 cost paid ALONGSIDE whatever replaced the mana cost, not instead of
it — is never read on that path: no sacrifice/exile picker, no life, no discard.
CR 118.9 replaces the MANA cost; it does not excuse an additional cost.

**Evidence.** `convex/game.ts` — the alt-cost branch builds
`altChoice` / `altHandChoice` from `chosenAltCost` alone
(`buildCastPermanentCostChoice(..., chosenAltCost, ...)`,
`buildCastHandCostChoice(player, chosenAltCost, ...)`) and computes
`altPayLife` from `chosenAltCost.life` plus the kicker legs only. Grep
`additionalCosts` in that file: every read sits in `finalizeTargetSelection`
(the targeted commit) or in the no-target branch — none in the alt-cost branch.
By contrast the two ordinary commit paths both fold
`effectiveAdditionalCosts` (this PR's flattened spec) into `payLife`, the
sacrifice selection and the hand picker.

The same PR fixed the sibling half of this shape — the NO-TARGET branch never
folded `additionalCosts.payLife` / `payXLife` either, so Toxic Deluge (c13,
`payXLife`) validated its life cost at announcement and then never charged it —
which is what makes this one plausible rather than speculative.

**Why it may not deserve its own issue.** No shipped card composes an
alternative cost with its own additional cost, so nothing is mispaid today: the
alt-cost cards (Gush, Thwart, Fireblast, Force of Will, the evoke Incarnations,
Dash) all carry `additionalCosts: undefined`. It is a fail-OPEN gap waiting for
the first card that combines them (Commandeer, Bringer cycle, several MH2/MH3
pitch spells with their own kicker-shaped riders), not a live bug — so it may
belong as a line on the cost-system tracker rather than a ticket of its own. If
it is ticketed, the fix is small and mechanical: thread the same
`effectiveAdditionalCosts` the other two branches already use.
