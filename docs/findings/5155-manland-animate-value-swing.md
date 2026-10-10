---
title: A manland's two faces are priced by two different readers, so animating it reads as a value swing
discoveredBy: 5155
status: draft
confidence: medium
---

**What is wrong.** After issue #5155 an unanimated Mishra's Factory on the
battlefield is `permanentWeight + manaWeight + 65.5` (its animate and pump
scripts at the standing reading, `landStandingAbilityValue` in
`convex/gre/evaluate.ts`). The moment it is animated it is a creature and
moves to the `evaluateCreature` branch: a 2/2 body plus the REALIZED ability
reading (un-discounted, `dslRealizedAbilityValueById`), with the mana term
still added by `permanentRealisedValue`. The two faces are computed by two
readers at two discounts, so the search sees animating (or being animated
by an opponent's effect) as a material swing whose sign and size depend on
the body-versus-script ratio, not on anything that happened on the board.
Issue #5155 explicitly left the creature face out of scope ("Manlands'
creature face (animate Op pricing)").

**Evidence.** `convex/gre/evaluate.ts` `permanentRealisedValue`: the
`isCreature(perm)` branch is taken first, so an animated land never reaches
`landStandingAbilityValue`; `evaluateCreature` adds
`dslRealizedAbilityValueById` for the same scripts at weight 1 instead of
`ABILITY_SCRIPT_DISCOUNT`. Probed in this session: Factory standing 65.5 in
hand and unanimated on the board. The must-tier blade suite is green, so no
pinned position moves — the swing is unpinned, not absent.

**Why it may not deserve its own issue.** The same two-reader shape already
exists for every non-creature permanent animated by an effect (an
enchantment under Opalescence, issue #5151's Sylvan Library case), and issue
#5151 chose the recurrence multiplier over unifying the readers. A manland
differs only in that it animates ITSELF, every turn, by choice — which is
also what makes it the most frequent case. One pinned position (a Factory
that should animate to block, or should not animate into a Wrath) would say
whether the swing actually misleads the search before anything is unified.
