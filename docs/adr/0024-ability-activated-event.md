# ADR 0024 — `ABILITY_ACTIVATED`: a separate event for the non-`{T}` half of "an artifact is used"

**Status:** Accepted (2026-06-18)

## Context

Antiquities cluster B (issue #285, PRD #269) introduces three punishers that
react to "an artifact is used" in two distinct ways (modern Oracle text):

- **Haunting Wind** — "Whenever an artifact becomes tapped **or** a player
  activates an artifact's ability without {T} in its activation cost, this
  enchantment deals 1 damage to that artifact's controller."
- **Powerleech** — same shape, gated on an opponent's artifact, gaining you
  1 life.
- **Artifact Possession** — Aura version, 2 damage to the enchanted
  artifact's controller.

The "becomes tapped" half is already modeled by `PERMANENT_TAPPED`
(CR 701.20a), emitted from every tap site (mana abilities, combat
declaration, Twiddle). The second half — **a non-`{T}` activated ability is
used** — has no event today. CR 602.1 activated abilities that have no tap
component (Triskelion's "Remove a +1/+1 counter: deal 1 damage", Basalt
Monolith's "{3}: untap") leave no trace any trigger can observe.

Two design questions:

1. **One event or two?** Could `PERMANENT_TAPPED` be widened to also fire on
   non-tap activations (e.g. an `activated: true` flag), or should this be a
   separate event type?
2. **What is the firing condition** — every activated ability, or only the
   ones without `{T}`?

## Decision

Introduce a **separate** `ABILITY_ACTIVATED` game event (CR 602.1), emitted
**only for activated abilities that have no `{T}` component in their cost**.
It is the strict complement of `PERMANENT_TAPPED`:

- A `{T}` ability already emits `PERMANENT_TAPPED` from its tap. Emitting
  `ABILITY_ACTIVATED` there too would double-count and double-trigger the
  punishers (each card declares one trigger per event). The emit site gates
  on `!ability.cost.tap`.
- Mana abilities (`useStack: false`, CR 605.3a) resolve immediately and never
  reach the activation commit site, so they never emit `ABILITY_ACTIVATED`.
  Their `{T}` taps still emit `PERMANENT_TAPPED` ("tapped for mana").

The event is emitted from a single shared anchor — `recordActivation` in
`convex/game.ts`, called at all three activation commit paths (immediate,
target-first, deferred-payment). Each path also flushes
`processPendingActionTriggers` (CR 603.3) so the punisher lands on top of the
freshly-pushed ability and resolves first. The event carries the source
permanent's controller / types / subtypes snapshotted at activation time
(CR 603.10 last-known information), mirroring the `PermanentTappedEvent`
payload, so `matches()` can filter on "your / an opponent's artifact" or
"enchanted artifact" without re-reading the registry.

A parallel trigger factory, `abilityActivatedTrigger`, mirrors
`tappedTrigger` (scope + permanent filter + condition + interveningIf). Cards
that want "tapped OR non-tap ability activated" declare **two** triggered
abilities — one per event — sharing an identical resolve body.

## Rationale

- **Two events, not a flag.** A flag on `PERMANENT_TAPPED` would force every
  existing tapped-trigger consumer (Manabarbs, Mana Flare, Lifetap, City of
  Brass) to grow a guard against the new case, violating the project's
  "composition over flags" rule (`.claude/rules/gre-development.md`). A
  distinct event type keeps each consumer reading exactly the occurrences it
  cares about and flows through the generic `collectTriggers` path with no
  changes to the collector.
- **Gating on `!cost.tap`, not "every activation".** This is the literal
  Oracle wording ("without {T} in its activation cost") and the clean
  partition: the union of `PERMANENT_TAPPED` (from the tap) and
  `ABILITY_ACTIVATED` (from the non-tap activation) covers "the ability was
  used" exactly once, with no overlap.

## Consequences

- A new `GameEventType` / `GameEvent` union member. Events are transient
  (`state.pendingEvents`, already in `serialize.ts`), so no new persisted
  `GameState` field and no schema-drift change.
- `recordActivation` now takes `state` and a `taps` flag at every call site —
  the single emit anchor guarantees all activation paths fire the event
  exactly once.
- **Known scope limit (unchanged by this ADR):** a non-mana `{T}` activated
  ability currently sets `card.isTapped` directly at the commit site without
  emitting `PERMANENT_TAPPED`. That pre-existing gap is orthogonal to cluster
  B (the three cards' "tapped" half is driven by mana-ability / combat /
  Twiddle taps, which do emit) and is left for a separate fix.
