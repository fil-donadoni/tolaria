# Computed static output driven by an on-entry stored choice

## Context

Continuous statics have so far carried **fixed** output data: `StaticSubtypeSet.subtypes` is a literal `string[]` (Blood Moon → always `["Mountain"]`). Illusionary Terrain ("As this enchantment enters, choose two basic land types. Basic lands of the first chosen type are the second chosen type.") is the first card whose static **output and applicability are both computed from a choice made on entry** — the ordered pair `[first, second]` picked as it enters. No shipped seam let a static's value come from stored per-instance data.

## Decision

Two orthogonal additions, each mirroring the existing `chosenPlayerId` precedent (Cursed Rack, CR 603.6b):

1. **On-entry stored choice.** A new `CardInstanceState.chosenSubtypes?: string[]` (ordered `[first, second]`), written by a `SpellContext.setChosenSubtypes` primitive from the card's ETB triggered ability, serialized (+ drift test), cleared when the permanent leaves. The ETB uses `resolve()` — the sanctioned _on-entry-choice-storage_ protocol class (same as `setChosenPlayer`), **not** a "missing Op" escape hatch: no Effect Script Op persists an instance-scoped choice.

2. **Computed static output.** An optional `StaticSubtypeSet.subtypesFor?(target, source, ctx) => string[] | null` callback that subsumes both `applies` and `subtypes` when present: it returns the replacement subtypes (Illusionary Terrain reads `source.chosenSubtypes`, gates on _effective_ subtype + `Basic` supertype, returns `[second]`) or `null` to opt a target out. The fixed `applies` + `subtypes` form stays the simple path for Blood Moon. The apply pass records the _computed_ value in the grant, so unapply/removal restores from the stored grant without re-invoking the callback.

## Considered Options

- **Data-only declarative indirection** (a "read stored choice" reference resolvable inside `applies`/`subtypes`) — rejected: invents a new declarative layer for a single card; `StaticSubtypeSet` already carries an `applies` closure, so a computed-output closure is consistent, not a new escape hatch.

## Consequences

- Intrinsic basic-land mana follows for free: mana is derived from effective subtype at read time (CR 305.6), so swapping the subtype swaps the mana with no separate seam.
- Reusable for the next chosen-value text/type-changing cards (Magical Hack, Sleight of Mind, chosen-subtype swaps) — the "computed static output from a stored choice" pattern is now named, so those cards extend the callback rather than re-litigating callback-vs-data.
- `subtypesFor` reads _effective_ (post-earlier-timestamp) subtypes, so multiple such statics compose by CR 613 timestamp order.

## Amendment (issue #2672) — the choice-storage half is superseded

Decision 1's _how the value gets there_ no longer holds. An "As … enters, choose …" clause is a static replacement whose choice is made before the permanent enters, so it is declared through the ADR 0100 as-enters seam (`entersWith.asEnters: [{ kind: "subtypes", from, count }]`), never an ETB trigger with a `resolve()` body: Illusionary Terrain moved there in issue #2467, Multiversal Passage and Traveler's Cloak in issue #2672, and the `SpellContext.setChosenSubtypes` primitive was removed with its last caller. `CardInstanceState.chosenSubtypes` keeps its shape and meaning.

Decision 2 — the computed `subtypesFor` output — is unchanged and current. A catalogue guard (`convex/cards/__tests__/asEntersNotTriggered.catalogue.test.ts`) keeps the next card off the trigger shape.
