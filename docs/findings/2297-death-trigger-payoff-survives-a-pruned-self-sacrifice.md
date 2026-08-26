---
title: A death-trigger or denial payoff can make the pruned self-sacrifice line correct again
discoveredBy: 2297
status: draft
confidence: medium
---

**What is wrong.** #2297's prune asks one question — "is the ability's benefit
confined to its own `$source`?" — and never asks the complementary one: "does
the source's ABSENCE have a payoff?". Value that comes from the SACRIFICE
rather than from the resolution is therefore invisible to it, and two shipped
classes of such value exist:

1. A `CREATURE_DIED` trigger the controller owns, which fires on the cost
   payment regardless of how empty the resolution is.
2. Sacrificing the source **in response** to an effect that would take or
   exile it — the "denying a gain-control effect" line #2297's own body names.

**The loss is wider than the only-victim case.** The in-loop skip in
`enumerateActivationCostPicks`
(`convex/gre/activationCostPicks.ts`, the `spareSource && victim.id ===
source.id` continue) drops the self-victim variant **even when other victims
exist**. So it is not only the "the source is my last creature" position that
disappears: with a full board, the bot still cannot choose to eat its own
outlet, which is exactly what the denial line requires — denying a gain-control
effect means sacrificing the SOURCE specifically, not the cheapest body.

**Evidence — the population is not empty.** A census of the shipped catalogue
(`getAllCards()`, `triggeredAbilities[].event` containing `CREATURE_DIED`)
returns **21** triggers, not zero. Four of them make the pruned line real:

| Card             | Where                                 | Why it matters                                                                                                                                                        |
| ---------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enduring Renewal | `convex/cards/sets/ice/white.ts`      | "Whenever a creature is put into your graveyard from the battlefield, return it to your hand" — sacrificing Fallen Angel to its own ability RETURNS the Angel to hand |
| Soul Net         | `convex/cards/sets/lea/colorless.ts`  | "Whenever a creature dies, you may pay {1}. If you do, you gain 1 life"                                                                                               |
| Earthlink        | `convex/cards/sets/ice/multicolor.ts` | "Whenever a creature dies, that creature's controller sacrifices a land"                                                                                              |
| Krovikan Vampire | `convex/cards/sets/ice/black.ts`      | reanimates a creature it damaged that dies this turn                                                                                                                  |

And **16** `gainControl` Op instances ship across 14 cards, so the denial line
has real opponents to deny.

The prune itself is a pure function of the ability:
`abilityBenefitIsConfinedToSource`
(`convex/gre/ai/sourceConfinedBenefit.ts`) takes no `GameState` and cannot
see any of the above; `sacrificeMustSpareSource`
(`convex/gre/activationCostPicks.ts`) adds only the two cost exemptions. The
blade entry "sac outlet: does not activate at all when it is its own only
victim" (`convex/gre/ai/blade/registry.ts`) encodes the current, stricter
answer as intended behaviour.

**Why it may not deserve its own issue.** (1) #2297 asks for exactly this
behaviour and names "Broader Bot evaluation tuning for sac outlets beyond the
dominated self-sacrifice case" as out of scope; conditioning the prune on "does
the source's absence pay" is a different axis from "is the benefit confined to
the source", and a different seam — the predicate would have to become
board-aware and response-window-aware. (2) The false negatives need a specific
co-occurrence on the battlefield (one of the five spare-classified outlets plus
a controller-side death trigger, or an opposing gain-control effect on the
stack), so the measured strength cost is likely small. (3) The prune is
deliberately fail-closed in the other direction — a wrongly-KEPT line only
costs search width — so the asymmetry the module was designed around now cuts
against it here, which is an argument for revisiting the design rather than for
a bug ticket.

**If it is ever picked up**, the cheap correction is NOT to make
`abilityBenefitIsConfinedToSource` board-aware (it is deliberately static).
It is to gate `sacrificeMustSpareSource` at its call site on a board predicate:
the controller has no `CREATURE_DIED` trigger on the battlefield AND no
gain-control/exile effect is on the stack targeting the source.
