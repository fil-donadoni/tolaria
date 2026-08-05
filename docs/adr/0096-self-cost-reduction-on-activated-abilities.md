# Self cost reduction is declared per ABILITY, and the self-host site grows an ability arm

**Status:** accepted

## Context

CR 601.2f cost reduction has one resolver (`resolveCostReductionGeneric`) and
one apply site (`applyCostModifiers`), reached through `getCostModifiers(state,
card, kind)` — `gre/state.ts`. That function accumulates from two places:

1. a **battlefield scan** for `cost-modifier` statics carried by permanents
   (Power Artifact scoping to its host, Gloom's board-wide increase);
2. a **self-host** arm (ADR 0063) reading `CardDefinition.selfCostReduction`
   off the announced card itself — added because Emry is not a permanent while
   she is being announced, so no battlefield scan can discover her own
   reducer.

The self-host arm is documented **spell-only**. `SelfCostReduction`'s own
comment says so: _"an activated ability has no 'self' spell object to
self-reduce"_.

The Kamigawa: Neon Dynasty channel lands break that assumption. Boseiju, Who
Endures and Otawara, Soaring City each carry a **Hand-Activated Ability**
(CR 113.6c — its cost discards the card, so it functions only from hand) whose
last clause is _"This ability costs {1} less to activate for each legendary
creature you control."_

That reduction is:

- **self-declared** — no other permanent grants it;
- **count-driven** — `CountDrivenCostReduction`'s exact shape, `{ perCount,
countFilter: { types: "Creature", supertypes: "Legendary" } }`;
- **announced from the hand** — the reducing object is not on the battlefield
  and never was, so the battlefield scan cannot see it. Structurally the same
  hole ADR 0063 opened the self-host arm to fill, one zone over.

Three shapes were available:

| option                                                          | why rejected / chosen                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a self-referencing `StaticCostModifier` with `appliesToAbility` | type-compatible, but discovered by a **battlefield scan** the source is not in. Would require teaching the scan about non-battlefield carriers — i.e. rebuilding the self-host arm inside the scan it exists to complement.                                                                 |
| `CardDefinition.selfCostReduction` extended to abilities        | wrong granularity. Boseiju has **two** activated abilities (`{T}: Add {G}` and the channel ability) and the Oracle says "**this ability**". A card-level declaration reduces every ability on the card — inert on today's two cards, a latent rules break on the next.                      |
| a sibling field on `cost`, folded in `resolveAbilityManaCost`   | that function folds **additional** pips onto a base cost (`manaEqualToCounterCount`, `manaEqualToEnchantedCreatureCost`). Reductions have their own apply site with the generic-only clamp and the `minTotalMana` floor. Splitting reductions across two sites is the drift ADR 0063 named. |

## Decision

**A self cost reduction on an activated ability is declared on that ability's
own cost, and `getCostModifiers` grows an ability arm to read it.**

```ts
interface ActivatedAbilityCost {
    // …existing legs
    /** CR 601.2f — this ABILITY's intrinsic discount to its own activation
     *  cost. The ability arm of ADR 0063's self-host reduction: read off the
     *  announced ability itself because its source may not be a permanent
     *  (a Hand-Activated Ability's card is in hand). Per-ability, never
     *  per-card — "this ability costs {1} less". */
    selfReduction?: CostReductionAmount;
}
```

`getCostModifiers(state, card, kind, ability?)` takes the announced ability
when `kind === "ability"` and accumulates `ability.cost.selfReduction` through
the **existing** `resolveCostReductionGeneric`. Nothing else moves: the three
amount shapes, the generic-only clamp, and the `minTotalMana` floor are the
ones already shipped, so a spell reduction and an ability reduction cannot
disagree about what a reduction is allowed to touch.

The reduction is named for the **mechanism** (`selfReduction`), never for the
clause that motivated it — the count filter is what says "legendary creature",
and a different card supplies a different filter with no new field.

## Consequences

**Two GRE consumers must be brought to the same answer.** The server applies
`getCostModifiers("ability")` at both `activateAbility` commit paths, but two
places read `ability.cost.mana` **raw** and call no modifier at all:

- `gre/moves.ts` — the bot's activation enumeration (the spell twin in the same
  file _does_ call `getCostModifiers`);
- `gre/autoTapDemands.ts` — `buildBoardAbilityDemands`, which would over-reserve
  mana for an ability that now costs less.

Neither is optional: a bot that thinks an ability is unaffordable never
activates it, and an auto-tap that over-reserves strands mana. This is the
cost of the decision, not a follow-up.

**No client mirror is needed for the show/hide gate.** `getStackAbilities` has
no mana field in its cost filter — a `useStack: true` ability's affordability
is never gated client-side and the server stays the single authority. That
also means the printed cost is what the player reads while a smaller cost is
what they pay; the engine has never displayed a live reduced cost for spells
either (Emry, Draco, Stratadon), and unifying that display is deliberately out
of scope here — doing it for abilities alone would widen the inconsistency
rather than close it.

**The mana-ability path stays unreduced.** `applyManaAbilityManaCost` /
`autoTapForManaAbilityCost` (`useStack: false`) read the raw cost and call no
modifier. That is untouched and correct for the cards at hand — a channel
ability uses the stack — but it is a known third reader, and a future
self-reducing mana ability lands there, not here.

**Revisit** if a self reduction is ever needed on a cost leg that is not mana
(nothing in CR 601.2f suggests one), or if a card declares a reduction that
must apply to _every_ ability it has — that is the card-level shape rejected
above, and it should be added alongside the per-ability field rather than
replacing it.
