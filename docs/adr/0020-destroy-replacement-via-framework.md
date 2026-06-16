# ADR 0020 — Destroy-replacement via the replacement framework; regeneration kept separate

**Status:** Accepted (2026-06-16)

## Context

Arabian Nights Batch 3 (#175) ships Pyramids, whose second mode is "the next
time target land would be destroyed this turn, remove all damage marked on it
instead" — a **replacement effect** (CR 614) that intercepts a destruction
before it happens. The engine already models destruction through
`regenerateOrDestroy` (CR 614.5 / 701.15a), which folds two distinct rules into
one tested function:

1. **Regeneration** (CR 701.15) — a specialised shield consulted at destruction
   time: spend a shield, heal marked damage, tap, remove from combat, and the
   permanent survives.
2. The actual move to the graveyard / exile.

`regenerateOrDestroy` is on the hot path for every lethal-damage SBA, combat
death, and `destroy` effect, and is covered by a large body of tests. Adding a
general "destroy replacement" layer must not perturb that body.

The replacement framework (`convex/gre/replacements.ts`, CR 614/616) already
handles `damage`, `lifegain`, `lifeloss`, `discard`, `lose-game`, and `tap`
events through `applyReplacementsLoop`, with both permanent-bound
`CardDefinition.replacementEffects[]` and transient state-level shields
(`damageRedirections`). Destruction is the natural next event kind.

## Decision

**Add `"destroy"` as a replacement event kind and run it through an additive
wrapper, leaving `regenerateOrDestroy` untouched. Regeneration is NOT migrated
into the new kind — it stays a specialised shield.**

Concretely:

- New `ReplacementEventKind: "destroy"` + `DestroyReplacementEvent
{ kind: "destroy"; targetInstanceId }`.
- `applyDestroyReplacements(state, event)` mirrors the other `apply*` siblings:
  it runs the CR 614 loop over permanent-bound `replacementEffects[]` with
  `eventKind: "destroy"`, then consults a transient
  `state.destroyReplacementShields` list (Pyramids mode 2). It returns the event
  if the destruction should proceed, or `null` if a replacement intercepted it.
  A consumed transient shield also removes all marked damage from the saved
  permanent (the oracle "remove all damage marked on it instead").
- `destroyWithReplacements(state, cardId, opts?)` is the additive wrapper: it
  runs `applyDestroyReplacements` first; if the destruction is replaced it
  returns `false` (the permanent stays), otherwise it falls through to the
  **unchanged** `regenerateOrDestroy`. Every existing destruction call site
  (spell/ability lethal damage, combat lethal, `destroy`, `destroyAll`) routes
  through the wrapper.
- `state.destroyReplacementShields` is a new persisted optional field
  (`PERSISTED_OPTIONAL_KEYS`, with a serialize round-trip + drift-guard test).
  Unconsumed shields wear off at their `duration` boundary in `tickAllDurations`.

## Rationale

- **Replacement effects and regeneration are different rules.** CR 614
  replacements rewrite/forbid an event before it happens; regeneration (CR
  701.15) is a shield consulted _as part of_ the destruction. Modelling Pyramids
  as a true replacement keeps the rules layering honest, while keeping
  regeneration where the CR puts it.
- **The hot path is untouched.** `regenerateOrDestroy`'s body and its tests are
  unchanged; the new behaviour is purely additive in a wrapper consulted before
  it. A game with no destroy-replacement shields and no `eventKind: "destroy"`
  cards pays only a cheap empty-list check.
- **It composes.** Future "if ~ would be destroyed, instead exile it / regenerate
  it / return it to hand" cards are now data: a permanent-bound
  `replacementEffects[]` entry with `eventKind: "destroy"`, no new engine work.
- **Not migrating regeneration avoids a risky rewrite.** Folding the
  well-tested regeneration shield into the replacement loop would touch the
  hottest combat path for no card-coverage gain in this batch.

## Consequences

- Destruction now has two intercept points consulted in order: CR 614 destroy
  replacement (this ADR), then CR 701.15 regeneration (inside
  `regenerateOrDestroy`). This matches the CR ordering (replacement before the
  event; regeneration as the event resolves).
- A new persisted field must stay in sync with the serializer (enforced by the
  drift-guard test, per the project's serialization rule).

## Related

- [ADR 0019](0019-blocked-is-explicit-combat-state.md) — sibling Batch 4a combat
  ADR.
- PRD #171 (Arabian Nights), issue #175 (Batch 3).
