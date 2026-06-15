# ADR 0012 — Transient combat block-restrictions (Raging River, pile combat)

**Status:** Accepted (2026-06-14)

## Context

**Raging River** (Alpha) is a triggered ability that fires when one or more
creatures you control attack:

> Each defending player divides all creatures without flying they control into
> a "left" pile and a "right" pile. Then, for each attacking creature you
> control, choose "left" or "right." That creature can't be blocked this combat
> except by creatures with flying and creatures in a pile with the chosen
> label.

Two things the engine lacks:

1. A choice that **partitions** a set — assigns _each_ non-flying defender to
   one of two labelled piles. `SpellContext.requestChoice` only selects a
   _subset_ of a zone; it cannot express "put every item into bucket A or B".
2. A **combat-scoped block restriction** that does not come from a card
   definition. Today `block-restriction` is a `StaticEffect` collected from a
   card's `staticEffects[]` ([ADR 0006][adr-0006]). Raging River's restriction
   is set up at resolution, lives for one combat, and is keyed by per-creature
   pile labels — it belongs to no card definition.

This is the deterministic twin of Camouflage, which is declared out of scope
([ADR 0010][adr-0010]).

## Decision

### A new `partition` PendingChoiceKind

`PendingChoiceKind` is an exhaustive taxonomy (`Record<PendingChoiceKind, …>`)
with adding-a-kind already a sanctioned, type-enforced extension point. We add
`"partition"`: divide a candidate set into two labelled buckets. Generic — not
Raging-River-specific — so any future two-pile effect reuses it. The defender
partitions their non-flying creatures; the attacker then labels each attacker
left/right (an ordinary per-attacker choice).

### Pile labels as transient combat state

Each divided creature carries a transient combat label and each attacker its
chosen label, alongside the existing combat fields (`isAttacking`, etc.). They
are combat-scoped and cleared at end of combat.

### A general transient block-restriction store on GameState

Rather than special-casing the combat code or injecting dynamic `StaticEffect`s
onto instances, the restriction lives in a new combat-scoped list on
`GameState`:

```ts
combatBlockRestrictions?: { attackerId: string; allowedPileLabel: string }[];
```

`validateBlockerEligibility` consumes it **generically** (alongside the
existing card-level `block-restriction` predicates): a candidate blocker is
legal against a restricted attacker iff it has flying or its pile label matches
the attacker's. This mirrors the engine's existing transient-effect stores
(`damageRedirections`, prevention shields) and adds **no per-card branch** to
`combat.ts`.

The store is combat-scoped but a stable-point save can occur mid-combat (during
declare-blockers priority), so it is added to `PERSISTED_OPTIONAL_KEYS` and
cleared at end of combat.

## Rationale

1. **Reuse the predicate machinery, not its plumbing.** The existing
   `block-restriction` evaluation is the right _shape_; only its _source_
   (card definition) is wrong for a transient effect. A separate store keeps
   card-sourced and combat-sourced restrictions cleanly distinct.
2. **General store over instance hack.** A typed list on GameState is
   reusable for future non-card combat restrictions and avoids special-casing
   the combat validator, consistent with `damageRedirections`.
3. **`partition` generalizes.** A reusable two-pile choice is worth more than a
   Raging-River-only widget and costs one entry in an already-exhaustive
   taxonomy.

## Consequences

- New `PendingChoiceKind: "partition"` and its submit handling.
- Transient pile-label fields on combat creature state.
- New `GameState.combatBlockRestrictions`; serialize key + cleared at end of
  combat; round-trip test.
- `validateBlockerEligibility` reads the new store generically.
- Raging River moves from commented stub to an active triggered ability.

## Out of scope

- **Camouflage** — its random pile-to-attacker assignment and simultaneous
  hidden two-sided division are excluded ([ADR 0010][adr-0010]). The
  `partition` choice kind built here is deterministic and player-labelled.
- Multi-defender pile combat (one attacker, several defending players) —
  single-defender assumption, matching the rest of combat.

[adr-0006]: ./0006-data-driven-combat-eligibility.md
[adr-0010]: ./0010-lea-out-of-scope-cards.md
