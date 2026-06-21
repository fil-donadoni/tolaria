# ADR 0031 — Nonbasic-land lockdown via composed static effects (Blood Moon)

**Status:** Accepted (2026-06-21)

## Context

Blood Moon (DRK, #419) reads "Nonbasic lands are Mountains." Per the modern
Comprehensive Rules this is a continuous type-changing effect (CR 305.7) applied
by the layer system (CR 611/613): every **nonbasic** land becomes a Mountain,
which means it

1. has its land subtypes replaced by `Mountain` (layer 4, CR 305.7),
2. loses its other land types **and all of its printed abilities** (layer 6,
   CR 613.1f — the "loses all abilities" half of a type-set, since a basic land
   type carries the intrinsic mana ability and the printed text no longer
   applies), and
3. gains the intrinsic "{T}: Add {R}" basic-land mana ability (CR 305.6), which
   the engine derives from `LAND_SUBTYPE_MANA[Mountain]` once the subtype is
   `Mountain`.

Basic lands — including basic Mountains — are untouched.

The engine already shipped two orthogonal static-effect primitives that, taken
together, express this exactly:

- **`subtype-set`** (layer 4, `convex/cards/types.ts` `StaticSubtypeSet`) —
  replaces a permanent's subtypes with a fixed array. Used by "enchanted land is
  an Island"-style auras.
- **`ability-loss`** (layer 6, `StaticAbilityLoss`) — strips **all** of a
  permanent's abilities: keyword abilities (into `removedKeywords`), activated
  abilities, triggered abilities, and intrinsic mana abilities. Introduced for
  Titania's Song (ATQ) and never given its own ADR.

The question this ADR settles: do we add a new "Blood Moon" / "lands become
Mountains" primitive, or compose the two existing ones? And does the existing
`ability-loss` correctly suppress a land's **printed activated mana ability**
everywhere the engine reasons about mana, including the cast-affordability
planner that drives the UI Cast button and auto-tap?

## Decision

**Compose, do not add.** Blood Moon's `staticEffects[]` is exactly two entries —
an `ability-loss` and a `subtype-set`, both gated by the same predicate
`IS_NONBASIC_LAND` (`getPrintedTypes(target).includes("Land") &&
!hasSupertype(target, "Basic")`). No new `StaticEffect` kind, no card-shaped
"landsBecomeMountains" primitive (which would fail the orthogonality test in
`.claude/rules/gre-development.md`). This mirrors the Titania's Song composition
(`ability-loss` + `type-add` + `pt-cda`) one set earlier.

Ordering matters and is already correct: `ability-loss` (layer 6) strips the
printed abilities, and the intrinsic Mountain mana ability is **re-derived from
the subtype** by the mana readers (`getBasicLandMana`), not stored as a printed
ability — so it survives the loss. This is why `getBasicLandMana` is
intentionally **not** gated by `abilitiesSuppressed`: a Mountain's mana ability
is a property of the type (CR 305.6), not a printed ability.

### Planner/handler suppression-sync invariant (the real fix)

The payment **handler** (`getActivatedManaAbility`, `getActivatedManaProduced`,
`getActivatedManaColor`, … in `convex/gre/constants.ts`) already short-circuited
to `null` when `abilitiesSuppressed(card)`. But two cast-affordability
**planners** in `convex/gre/rules.ts` read `def.activatedAbilities` directly
without the suppression check:

- `getProducibleManaOptions` — the per-source color hint that drives the UI Cast
  button and the bot's `planManaPayment`.
- `getProducibleManaUnits` — the affordability counter (`canPayCost`).

Left unfixed, a dual land under Blood Moon would **advertise its original colors**
(e.g. {G}/{U} for Tropical Island) to the planner while the handler paid {R}
from the Mountain subtype — a silent planner/handler desync of exactly the class
`.claude/rules/gre-development.md` warns about ("two pieces passing individually
but failing together is a shipped bug"). Both planners are now gated by the same
`abilitiesSuppressed(card)` check, and `abilitiesSuppressed` is promoted from a
file-local helper to an exported function so every mana reasoner shares one
definition. The invariant: **anything that enumerates a permanent's printed
activated mana abilities must honor `abilitiesSuppressed` so the planner and the
payment handler never disagree.**

## Consequences

- Blood Moon is fully CR-correct and recomputed live by the layer system;
  `unapplySourceStaticEffects` reverts the subtype, abilities, and producible
  colors cleanly when the enchantment leaves play. A nonbasic land that enters
  **after** Blood Moon resolves is locked down via `applyExistingGrantsTo`.
- Dual lands, utility lands (Strip Mine — its "destroy target land" ability is
  gone), and any future nonbasic land are covered by the same two-static
  composition with no per-card engine work.
- The producible-mana planners now agree with the payment handler under any
  ability-removal effect (Blood Moon **and** Titania's Song on a mana rock), not
  just Blood Moon — the fix is at the bug class, not the single card.
- **Not added:** a new ability-removal `StaticEffect` kind. The existing
  `ability-loss` was sufficient; this ADR documents the (previously
  undocumented) primitive and the suppression-sync invariant rather than
  introducing new mechanism.
- **Deferred / out of scope:** the printed-Alpha wording "all lands are
  Mountains" — modern Oracle (ADR 0004) scopes it to nonbasic lands, which is
  what we implement.
