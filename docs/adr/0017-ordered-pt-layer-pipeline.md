# ADR 0017 — Ordered P/T layer pipeline (CR 613.4)

**Status:** Accepted (2026-06-16)

## Context

Until now `getEffectivePower` / `getEffectiveToughness` (`convex/gre/layers.ts`)
computed power/toughness as a **flat sum**:

```
effective = base + staticPTBuff(pt-buff + pt-cda) + temporaryPTBuff + counterPTBuff
```

Every contribution is an addend. This is correct as long as all effects are
**deltas** (+N/+N): pump spells, counters, anthems (Crusade, Bad Moon) all add,
and addition is order-independent.

Arabian Nights introduces the first **set** effects — characteristics forced to
a specific value (CR 613.4b, layer 7b):

- **Singing Tree** / **Island of Wak-Wak** — "base power 0 until end of turn"
  (sets power only, leaves toughness).
- **Sorceress Queen** — "{T}: target creature has base power and toughness 0/2
  until end of turn" (sets both, applied by an activated ability to _another_
  permanent).

A set is **not an addend** — it replaces the base, and everything in higher
sublayers (counters 7c, modifiers 7d) must apply _on top_ of the set value.
`Sorceress Queen`'s 0/2 with a +1/+1 counter is a 1/3, not a 0/2 plus a stray
+1/+1 folded into a sum that already lost the original base. The flat sum cannot
express this; the read path must become an **ordered evaluation**.

A secondary consequence: `pt-cda` (characteristic-defining abilities, layer 7a)
was previously folded into the summed `staticPTBuff` bucket. A CDA is the
_starting_ value, and a 7b set must be able to **override** it — so `pt-cda`
can no longer live in the post-set summed bucket. It is promoted to the 7a
base-defining stage.

## Decision

### `getEffective*` becomes a timestamp-ordered pipeline, not a sum

The read path evaluates the CR 613.4 sublayers in order:

```
7a  CDA        → starting value (pt-cda promoted here, no longer summed)
7b  set P/T    → overrides per characteristic; latest timestamp wins (CR 613.7)
7c  counters   → +/- from counters
7d  modifiers  → static pt-buff + temporaryPTMods (pump, anthems)
7e  switch P↔T → power/toughness swap (Power Conversion / Inversion)
```

Sublayer order is fixed; within a sublayer, multiple effects resolve by
timestamp (CR 613.7). Still computed at **read time**, never mutating card
state — same discipline as the previous sum.

### Set effects are timestamped temporary entries on the target

Mirroring `temporaryPTMods` (deltas), set effects live on the instance as a
parallel **`temporaryPTSet`** list:

```ts
temporaryPTSet?: { power?: number; toughness?: number; timestamp: number; duration: DurationSpec }[];
```

- **Per-characteristic** — `power?`/`toughness?` independently optional, so
  "base power 0" sets power and leaves toughness untouched.
- **Applied to the target, not declared as a `staticEffects[]` on the source** —
  because the effect is one-shot with a duration and (Sorceress Queen) comes
  from an activated ability aimed at another permanent. This is the SET analogue
  of the existing temporary-delta machinery, purged by the same phase-boundary
  cleanup.
- **Optional field** — absent on essentially every instance; fast-pathed at read
  time. Added to `PERSISTED_OPTIONAL_KEYS` (`serialize.ts`) with a round-trip
  smoke test (CLAUDE.md serialization rule).

### 7e is present but stubbed until a switch card exists

No card currently in scope (none in Arabian Nights, none earlier) swaps power
and toughness. The 7e stage exists **explicitly in the pipeline** to keep the
layer order faithful to CR 613.4, but its body **asserts-unreachable** rather
than implementing a swap. The first power↔toughness card lands the 7e body
together with its own test.

This deliberately avoids shipping untested dead code (the wire-test /
`feedback_full_card_implementation` rule) while still encoding the full,
correct sublayer order — a future reader sees where 7e belongs without having to
re-derive it.

## Considered Options

- **Insert a set-step into the flat sum, keep everything else summed.** Rejected:
  it handles 7b in isolation but leaves `pt-cda` mis-ordered (summed after the
  set instead of overridable by it), and re-introduces the same flat-sum problem
  the next time a non-additive sublayer appears.
- **Build 7e to completion now.** Rejected: no card exercises it, so it would be
  untested speculative logic.

## Consequences

- `getEffectivePower` / `getEffectiveToughness` are on the combat, SBA, and
  targeting hot paths; every consumer keeps the same signature, but the internal
  computation order changes. Mandatory wire-format tests re-run the P/T
  assertions through `projectPublicState` (set, set+counter, set+pump, two sets
  by timestamp).
- Humility-class effects (set all creatures to 1/1) become expressible later by
  generalizing the same 7b machinery — previously impossible under the flat sum.
