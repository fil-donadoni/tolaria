---
title: A cast's hand-cost legs are priced per family, never together
discoveredBy: 2267
status: draft
confidence: medium
---

**What is wrong.** A cast can owe hand cards from several families at once: the
alternative cost's hand leg (Force of Will's "exile a blue card"), the card's
own additional discard (`castExtraHandCostLegs`: own discard, retrace), and
the kicker-family legs (Kicker, Multikicker, Escalate). `buildCastHandCostChoice`
pays them all in ONE combined picker, but nothing prices them together.
`canPayKickerLegs` pools only the kicker-family legs, and the client's mode
picker cap (`perExtraModeAffordableModeCap`) prices escalate alone. Escalate
plus retrace, or plus the card's own discard, can therefore pass every gate and
then park a picker no hand can complete. An exile alt cost plus a discard
escalate throws "These costs cannot be paid together"
(`buildCostLegsHandChoice`, `convex/gre/alternativeCost.ts`), although the CR
lets you pay both (CR 601.2h).

There is a second, smaller gap. The pooled greedy (`canPayHandCost`, and the
picker's own `validateAlternativeHandCostPicks`) allocates requirements in
declaration order, so it can under-approve when a broad requirement comes
before a narrower one from a different entry.

**Evidence.**

- `convex/gre/kicker.ts`: `canPayKickerLegs` reads `kickerCostLegs` only.
- `convex/game.ts`: `castExtraHandCostLegs` is added only at picker-build time.
- `buildCostLegsHandChoice` rejects mixed actions.

**Why it may not deserve its own issue.** No shipped card combines these
families today. Collective Brutality has only its escalate discard. The
fix should land when a card needs it: price the whole combined hand cost through
the picker's own builder (or a bipartite match), in both places.
