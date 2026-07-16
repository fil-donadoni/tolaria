# Loyalty abilities as a signed `cost.loyalty` member

## Status

accepted

## Context

The engine had `"Planeswalker"` as a recognized card type and a printed
`CardDefinition.loyalty` field, but nothing behind them: no starting-loyalty
placement, no loyalty counters, no loyalty abilities, no 0-loyalty death, and
damage to a planeswalker meaninglessly marked `damageMarked` on a permanent with
no toughness. This ADR records the FRAMEWORK decisions (issue #700) that make a
planeswalker a first-class permanent, deliberately scoped to the framework plus
two tracer planeswalkers — combat (attacking a planeswalker), emblems, and the
remaining Cube planeswalkers are separate follow-ups.

Two originally-listed requirements are dead letters under the modern CR (ADR 0004) and need no code:

- **Uniqueness** — removed from the CR in 2017. Every planeswalker is Legendary,
  so the legend rule (ADR 0030 legend-keep SBA) already handles two-of-a-name.
- **Damage redirection to a planeswalker** — removed in 2018. Damage is dealt to
  the planeswalker directly, removing loyalty.

The central question was how to model a **loyalty ability** (CR 606). A
planeswalker's activated ability is special in three ways — it is sorcery-speed,
it can be activated at most once per permanent per turn, and its cost is a change
to the permanent's loyalty that may not go below 0. A naive model would add three
independent flags (`sorcerySpeed`, `oncePerTurnLoyalty`, `loyaltyCost`) to
`ActivatedAbility`, which is redundant: a loyalty ability is exactly "an
activated ability with a loyalty cost", and all three restrictions follow from
that single fact.

## Decision

**A loyalty ability is marked by a single signed `ActivatedAbility.cost.loyalty:
number` (`+N` add, `-N` remove, `0` neutral).** Its mere presence makes the
ability a loyalty ability; the engine derives all three CR 606 restrictions from
it, so no separate flags exist:

- **CR 606.3 sorcery-speed + controller's turn** — reuses the existing
  `isSorceryTiming(state)` gate (main phase, empty stack, active player holds
  priority) plus `activePlayerId === card.controllerId`. No new timing concept.
- **CR 606.3 one loyalty ability per permanent per turn** — a per-instance
  `CardInstanceState.loyaltyActivatedThisTurn` boolean, set at activation commit
  and reset for every permanent at the start of each turn (beside the existing
  `activationsThisTurn` reset). This is per-PERMANENT (across all of its loyalty
  abilities), which the existing per-ABILITY `oncePerTurn` mechanism could not
  express.
- **CR 606.5 not below 0** — a `-N` cost is illegal when
  `current loyalty + N < 0`.

Both the gate (`assertLoyaltyActivationLegal`) and the payment (`payLoyaltyCost`,
which adjusts `counters["loyalty"]` and sets the once-per-turn lock) live in
`convex/game.ts` and run at every activation commit site (immediate no-target
and `finalizeTargetSelection` for targeted loyalty abilities like Liliana's
`-2`). A loyalty ability has no mana/tap/sacrifice component, so it never enters
the deferred `pendingActivation` payment path.

**Loyalty counters reuse the generic `counters` map.** Starting loyalty
(`CardDefinition.loyalty`, CR 306.5b) is placed as `counters["loyalty"]` on ETB,
in the same block that handles `entersWith.counters`. Damage to a planeswalker
(CR 120.3) removes loyalty counters instead of marking `damageMarked` — done in
BOTH non-combat damage sinks (`removeLoyaltyForDamage`), so burn "to any target"
kills a planeswalker (planeswalkers are already in
`DAMAGEABLE_PERMANENT_TYPES`). A planeswalker at 0 loyalty is put into its
owner's graveyard by a new state-based action `checkZeroLoyaltySBA` (CR 704.5i),
a direct sibling of the zero-toughness sweep. Because loyalty rides the existing
`counters` map, it round-trips through serialization and the wire projection
(`slimCard`) for free; only the new `loyaltyActivatedThisTurn` flag needed a
serialization row.

**Census (ADR 0045/0046, honest status).** `cost.loyalty` is a cost-system +
activation-timing capability, NOT a CR 701/702 keyword (it contributes no
`staticAbilities[]` string) and NOT an Effect Script Op (a loyalty ability's
one-shot EFFECT is a normal effect script whose Ops are censused like any
other). It therefore gets no `MECHANICS_REGISTRY` / `ENGINE_INTERNAL_MARKER` /
`EFFECT_OP_REGISTRY` row — the same disposition as the alternative-cost
mechanics (Cycling, Flashback, Escape, energy spend). This is documented as a
census note in `mechanicsRegistry.ts` rather than invented as a name.

**Tracers.** Liliana of the Veil (ISD) is implemented in full — all three
loyalty abilities reuse only already-exercised Ops (forEach-players discard,
edict, `divideIntoPiles`). Karn, Scion of Urza was the second listed tracer but
each of its three abilities needs a genuinely new Op (library-top reveal +
opponent-choice routing, a counter-tagged exile with a counter-filtered exile
return, a dynamic-P/T token), so per issue #700's explicit "swap for a simpler
emblem-free planeswalker" clause it is replaced by **Garruk Wildspeaker** (LRW),
whose three abilities (untap two target lands, create a 3/3 Beast, mass
+3/+3-and-trample) are all existing Ops.

## Consequences

- A new planeswalker is now pure data: declare `loyalty` + `activatedAbilities`
  with `cost.loyalty`, and write each ability's effect as an ordinary effect
  script. No engine changes per card.
- Loyalty rides the generic counters map, so every counter-aware surface
  (serialization, wire projection, on-card display) covers it without
  planeswalker-specific plumbing.
- Out of scope (separate issues): attacking a planeswalker in combat
  (declare-attackers defender target + combat-damage → loyalty routing), the
  emblem subsystem, and the remaining ~18 Cube planeswalkers.
