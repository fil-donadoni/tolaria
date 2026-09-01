---
title: announceCast's UNTARGETED alternative-cost branch folds no cost modifiers — CR 118.9d increases and reductions silently miss Gush and Foil
discoveredBy: 2383
status: draft
confidence: high
---

**What is wrong.** `announceCast`'s no-target branch (`convex/game.ts`) builds
`altManaCost = normalizeManaCost(chosenAltCost.mana ?? {})`, folds Kicker and
the conditional-flash surcharge onto it, and then goes straight to
`isManaCostCovered` and `pendingCast.manaCost = altManaCost`. There is no
`applyCostModifiers(…, getCostModifiers(…))` anywhere between. Its TARGETED
twin, `finalizeTargetSelection`, does fold them onto the alt-derived cost.

CR 118.9d: "If an alternative cost is being paid to cast a spell, any
additional costs, cost increases, and cost reductions that affect that spell
are applied to that alternative cost. (See rule 601.2f.)"

So an untargeted alternative-cost spell is cast at exactly its alternative
cost, with every CR 601.2f increase and reduction on the board ignored.

**Scenario.** Elite Spellbinder (issue #2383) exiles the opponent's **Gush**
(`convex/cards/sets/mmq/blue.ts`, alt cost "return two Islands you control",
untargeted). The owner casts it from exile choosing the alt cost: the
object-scoped `{2}` tax never joins the total. **Foil** (`pcy/blue.ts`) is the
same shape. The asymmetry is the tell — Force of Will, Daze, Thwart and
Dominate all TARGET, so they route through `finalizeTargetSelection` and are
taxed correctly.

The same hole swallows every shipped battlefield `costIncrease` static (the
Thorn Elemental shape in `inv/*`, `fem/black.ts`, `lea/black.ts`,
`wth/white.ts`) and every `costReduction` static, for the same untargeted
alt-cost casts. It predates #2383 by a long way.

**Why nothing is visibly broken today.** The affordance gate has the matching
hole: `getLegalActions`'s alternative-cost branch (`convex/gre/rules.ts`) calls
`canPotentiallyPayCost(caster, card, alt.mana ?? {}, state)` WITHOUT
`foldCostModifiers`, and its own comment records that as deliberate (issue
#1695 scoped the fold to the plain hand-cast branch). Gate and payment
therefore agree on the wrong number, so nothing parks unpayable and no test
disagrees — the spell is just undercharged.

**Suggested slice.** Fold `getCostModifiers` onto `altManaCost` in the
no-target branch AND set `foldCostModifiers: true` on the alt-cost affordance
branch, in the same change — moving only one of them turns a silent
undercharge into a cast that parks unpayable in `pendingCast`. Worth checking
the Bot's `enumerateCastMoves` alt-cost variants at the same time.
