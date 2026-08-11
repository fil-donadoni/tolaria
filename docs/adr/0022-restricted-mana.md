# ADR 0022 — Restricted mana (spend-only-on constraints)

**Status:** Accepted (2026-06-17)

## Context

Metamorphosis (ARN, #180) is the engine's first card that produces mana
carrying a **spend restriction**: "Add X mana of any one color … Spend this
mana only to cast creature spells" (CR 106.6). The mana otherwise behaves
normally — it floats in the pool and empties at end of step/phase (CR 500.4) —
but it may pay for creature spells only.

The mana subsystem models the pool as a flat, fungible `manaPool:
Record<string, number>`. Payment runs through three pure helpers in
`gre/state.ts` — `isManaCostCovered` (affordability), `payManaCost`
(deduction), `getManaSubstitutions` (CR 609.4b "spend as though") — invoked at
every spell-cast and ability-activation site in `game.ts`. A fungible pool has
no place to record "this unit can only pay for X", so the constraint needs a
parallel structure.

Two further questions had to be settled:

1. **Where the color is chosen.** The printed card chooses the color on
   resolution. The engine has no resolution-time color-picker choice family —
   adding one means a new `PendingChoice` family (new submit mutation, new
   `assertNoPendingChoices` branch, new frontend picker).
2. **Which payment sites enforce the restriction.** Restricted mana can pay
   only for creature _spells_, never for activated abilities or may-pay costs.

## Decision

### 1. A parallel `restrictedMana` list on `PlayerState`

```ts
type RestrictedMana = { color: string; amount: number; restriction: ManaRestriction };
PlayerState.restrictedMana?: RestrictedMana[];
```

`ManaRestriction` is a string union (today the single member
`"creature-spell"`), defined in `gre/types.ts` so both `cards/types.ts` and
`gre/state.ts` import it without a cycle. Restricted mana is kept **separate
from** `manaPool` rather than tagged inline, so the fungible-pool helpers and
all ability/cost sites that don't care about the restriction stay untouched.

It is emptied alongside `manaPool` at end of step/phase (`emptyManaPools`,
CR 500.4) and on `drainManaPool` (CR 106.4).

### 2. Three new pure helpers, layered on the existing ones

- `restrictionAllowsSpell(restriction, isCreatureSpell)` — the eligibility
  predicate (exhaustive `switch` over the union).
- `spendablePoolForSpell(player, isCreatureSpell)` — returns `manaPool` plus
  any restricted mana the spell may use, for the affordability check.
- `payManaCostForSpell(player, cost, isCreatureSpell, subs)` — pays drawing on
  **eligible restricted mana first**, then the fungible pool.

`payManaCostForSpell` does not re-implement payment. It merges eligible
restricted mana into a working copy of the pool, runs the existing
`payManaCost` against the merge (so substitution / colored-then-generic
semantics are identical), then **settles** the per-color consumption
restricted-first back onto the two structures. Spending restricted mana first
is a settlement policy: it maximises the flexible mana the caster keeps and can
never make a payment illegal, since coverage was already confirmed against the
merged pool.

### 3. Restriction enforced at spell-cast sites only

The three spell-cast payment sites in `game.ts` —
`tryAutoCommitPendingCast`, the manual-cast branch, and the main `castSpell`
immediate-commit branch — switch from `manaPool` / `payManaCost` to
`spendablePoolForSpell` / `payManaCostForSpell`, passing
`cardDef.types.includes("Creature")`. The ability-activation and granted-ability
sites are left untouched: restricted mana never pays for them.

### 4. Color chosen at announcement via the existing modal flow

Metamorphosis's "any one color" is modelled as **five modes** (one per color),
picked at announcement through the engine's existing, fully-wired modal cast
flow (`chosenModeId`, the UI mode picker, stack-item dispatch to
`mode.resolve`). Each mode's `resolve` adds `1 + getAdditionalSacrificeMv()`
restricted mana of its color via the new `SpellContext.addRestrictedMana`
primitive. The sacrifice is the card's `additionalCosts.sacrificeFilter`, paid
at announcement (CR 118.8); its mana value is snapshotted onto the stack item
and read at resolution.

## Consequences

- **No new choice subsystem.** Reusing modes avoids a bespoke resolution-time
  color picker (mutation + assertion + frontend). The cost is a deliberate,
  invisible deviation: the color is locked at announcement (CR 700.2c) rather
  than chosen on resolution. All five colors are always legal and nothing
  between announcement and resolution can change that, so no game state differs.
- **The hot path grows by one branch.** Spell-cast affordability/payment now
  consults `restrictedMana`; the change is inert (one `?? []` skip) for the
  overwhelming majority of casts where no restricted mana exists.
- **Documented simplifications.** `drainManaPool` (Mana Short / Drain Power,
  CR 106.4) clears restricted mana but does **not** fold it into the drained
  record it returns — Drain Power would gain it as unrestricted mana. This is a
  rare interaction and left for a future ADR. `commitLandsForCost` is still
  called with the full cost even when restricted mana paid part of it; in
  practice no stray tapped-uncommitted land of the matching color exists at cast
  time, so no land is wrongly committed.
- **Extensible.** New restrictions (e.g. "spend only on artifact spells") add a
  `ManaRestriction` union member and a `restrictionAllowsSpell` case; the
  storage, serialization, emptying, and settlement logic are reused as-is.
