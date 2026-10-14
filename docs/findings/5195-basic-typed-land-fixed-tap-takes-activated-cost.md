---
title: A land with a basic land type tapped without an index pays its FIRST activated mana ability's cost (a sacrifice included) while adding the intrinsic colour
discoveredBy: 5195
status: draft
confidence: medium
---

**What is wrong.** The fixed tap branches of `tapSourceIntoPayment` and
`tapUntap` (`convex/game.ts`) take the COLOUR from
`getBasicLandMana(card) ?? getActivatedManaColor(card)` but the COST and riders
from `getActivatedManaAbility(card)` — the first activated mana ability. When a
land has a basic land type (CR 305.6, its intrinsic "{T}: Add [symbol]") AND a
printed or granted activated mana ability whose cost carries more than {T}, an
index-free tap names the intrinsic colour yet pays the activated ability's cost.
The review of issue #5195 probed it: a Forest-typed land carrying "{T},
Sacrifice this land: Add …", tapped with no index, was sacrificed and added
that ability's output instead of the land's own {G}.

The index-free path is reachable whenever the unified option list
(`getManaTapOptionsDetailed`) collapses to ONE primary option — the sacrifice
alternative is appended behind the primary options (issue #3630), so a plain
click on such a land is index-free.

Issue #5195 fixed the AMOUNT half of the same split (`getFixedManaAmount` no
longer scales a basic-typed land's intrinsic tap by an activated ability's
board count — Gaea's Cradle under Urborg); the COST half is this finding.

**Evidence.** `convex/game.ts` `tapSourceIntoPayment` fixed branch:
`const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card)` beside
`const acting = multiColorAbility ?? ability` (with `ability =
getActivatedManaAbility(card, state)`), then `isSacrifice = acting?.cost.sacrifice`;
the same pair in `tapUntap`'s fixed branch.

**Why it may not deserve its own issue.** It needs a type-changing effect or an
unusual printed land (a basic-typed land with a costed activated mana ability)
to reach; no shipped preset builds that board. If the fixed branches were
rewritten to resolve colour, amount AND cost from `primaryManaTapOptions(...)[0]`
the whole class closes at once — that is the shape a fix should take.
