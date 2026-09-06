# CR 613.8 dependency is DECLARED, not derived: a static read/write relation, an SCC collapse, and 613.8c discharged as vacuous under a named approximation

## Status

accepted (discharges ADR 0082 decision 3, which deferred these questions until
the Continuous Effects Registry existed; shapes issue #2068, whose acceptance
surface is issue #3098)

## Context

CR 613.8 is the only part of the layer system Tolaria has never implemented.
The rule, in full:

```
613.8.  Within a layer or sublayer, determining which order effects are applied in is sometimes
        done using a dependency system. If a dependency exists, it will override the timestamp
        system.

613.8a  An effect is said to "depend on" another if (a) it's applied in the same layer (and, if
        applicable, sublayer) as the other effect; (b) applying the other would change the text or
        the existence of the first effect, what it applies to, or what it does to any of the things
        it applies to; and (c) neither effect is from a characteristic-defining ability or both
        effects are from characteristic-defining abilities. Otherwise, the effect is considered to
        be independent of the other effect.

613.8b  An effect dependent on one or more other effects waits to apply until just after all of
        those effects have been applied. If multiple dependent effects would apply simultaneously
        in this way, they're applied in timestamp order relative to each other. If several
        dependent effects form a dependency loop, then this rule is ignored and the effects in the
        dependency loop are applied in timestamp order.

613.8c  After each effect is applied, the order of remaining effects is reevaluated and may change
        if an effect that has not yet been applied becomes dependent on or independent of one or
        more other effects that have not yet been applied.
```

ADR 0082 deferred it deliberately, on the ground that dependency is not
decidable from a single effect: 613.8a asks whether applying _another_ effect
would change this one, which requires seeing every effect in a layer at once.
Before the Continuous Effects Registry there was no such place. PRD #2064
S1-S4 built it, and ordering now goes through exactly one authority —
`compareContinuousEffects` (`gre/continuousEffects.ts`), called from five
sites. The deferral's precondition is discharged, so the deferred questions
come due.

### 613.8c is the rule that decides the shape, and it was missing from the ticket

Issue #2068 framed the work as "cycle detection in the dependency graph, then a
topological sort with cycles collapsed into timestamp-ordered groups". That
framing came from a CR revision that predates 613.8c, which the ticket never
quoted.

613.8c is not a detail. It says the ordering is **re-derived after every single
application**, because applying one effect can create or destroy a dependency
among the effects still waiting. Under 613.8c the dependency graph is not an
input to a sort — it is a thing that changes underneath an iterative selection.
Any design that computes an order once and then applies it is, on the literal
reading, wrong.

### The read side has no structure to read

A dependency edge is, operationally, "B writes something A reads, in the same
layer". The write half is free: it is the registry entry's `payload.kind`, and
613.8a clause (a) narrows it hard, because each layer writes exactly one family
of characteristics and nothing crosses layers.

The read half has nowhere to come from. An effect's predicate is
`applies: (target, source, ctx) => boolean` — an opaque closure, declared 295
times across 134 card files. Nothing can compute what it reads.

### One structural asymmetry halves the problem

`ContinuousEffectScope` (S1, issue #3002) admits exactly two arms:

- `affected: { kind: "predicate" }`, pinned by its type to `source` expiry and a
  template payload — the predicate is the template's live `applies` /
  `condition`;
- `affected: { kind: "instances", instanceIds }` — a set frozen at creation per
  CR 611.2c, whose payload may be inline, i.e. frozen data.

Clause (b) asks whether applying the other effect would change _what it applies
to_ or _what it does to them_. For an `instances` entry with an inline payload,
neither can change: there is no closure to re-evaluate, only data. Such an entry
can be the **target** of a dependency but never a **dependent**. Only the
predicate/template arm needs analysing at all.

## Decision

### 1. Detection is DECLARATIVE

An edge is `writes(B) ∩ reads(A) ≠ ∅` within one layer, read from static
metadata. Not "apply B, re-derive A, diff the result".

The read set is declared as **a table keyed on `StaticEffect["kind"]`** — a
closed union whose exhaustiveness `tsc` enforces — **plus a per-declaration
override** for a predicate narrower than its kind's default. The table
over-declares by construction, being the union of what any predicate of that
kind could read; the override is how a declaration buys back precision it
actually needs. Most of the 295 declarations never touch it.

The literal reading of 613.8a — speculative double evaluation — is rejected as
the production path for a reason 613.8c supplies: detection runs once **per
effect applied**, not once per read, so it must be a table lookup rather than a
derivation.

### 2. Over-declaring is nearly free, and the exception is named

Two effects that are genuinely independent under 613.8a produce the same result
in either order — that is what independence means. So a phantom edge on a
linear path changes nothing observable.

It is **not** free when a phantom edge closes a loop: 613.8b then discards the
dependency system for that whole loop, taking any real dependency inside it
down as well. The table is therefore kept tight and argued per kind, never
generous "just in case".

### 3. The relation is STATIC, so 613.8c is vacuous — and that is an APPROXIMATION

613.8c re-evaluates because a dependency can appear or disappear as the board
changes under application. An edge read from static metadata cannot change under
application. The graph is fixed, and 613.8c is satisfied trivially.

This is recorded as a **documented approximation, not a faithful
implementation**. A dependency that exists only on a board mid-application — one
the CR's own re-evaluation clause exists to catch — is invisible to a static
table. The guard is decision 4.

### 4. An oracle proves the table, in tests

A test-only implementation of 613.8a taken literally, asserted to agree with the
declared table on every acceptance board.

It is far cheaper than the "re-derive everything" strawman, because clause (b)
unpacks into three small probes: re-run `applies` over the board with the other
effect applied and compare the affected set; recompute the payload (frozen, and
therefore trivially unchanged, for an inline one); ask whether the source still
generates the ability. None of that is a full layer derivation.

The oracle catches exactly the two things the table cannot guarantee alone: a
false negative, which is a wrong board state, and a false positive that closes a
loop.

### 5. Ordering stays PER-TARGET

The dependency relation is a property of the effect _pair_, not of the permanent
being derived, so the ordered sequence is identical for every permanent. It is
computed once per layer per read, and the existing per-target walk consumes it.

The board-wide interleaved application a literal reading of 613.8b/c would
demand — pick an effect, apply it to every object it touches, then re-evaluate —
is not built. It would discard the derivation architecture PRD #2064 S2-S4 just
landed, and under decision 3 it buys nothing.

### 6. Loops: strict reading, collapsed by strongly connected component

"This rule is ignored" applies to the effects **inside** the loop only. An
effect outside a loop that depends on a loop member still waits for it; the
alternative lets an unrelated pair of cards disable ordering across a whole
layer.

A "dependency loop" is a strongly connected component. The CR's singular "the
loop" stops being an identifiable object as soon as two cycles share a node, and
the SCC is the only well-defined generalisation.

The algorithm:

1. Tarjan over the layer's dependency graph, producing the condensation.
2. Kahn over the condensation; among **ready** nodes take the earliest
   timestamp — 613.8b's middle clause.
3. Within an SCC, timestamp order — 613.8b's loop clause.

**The "timestamp order" the CR names is the layer's existing comparator**, never
a fresh `a.timestamp - b.timestamp`. Layer 6 wraps `compareContinuousEffects` in
`compareLayer6Entries`, whose tie-break puts removals and ability-loss before
grants at an equal timestamp so the walk agrees with
`grantOutrankedByAbilityLoss` by construction rather than by luck. Dependency
decides the order _between_ groups; the existing comparator decides it _within_
a group.

### 7. Every layer, uniformly

Not a cost/coverage trade. `.claude/rules/gre-development.md`: _"A MECHANIC is
implemented WHOLE, never partially shipped behind a marker: every subrule of its
CR section, on every surface."_ Layer-4-only, where the famous cards live, would
be a partial ship behind a marker.

### 8. It lands after the materialised fields are gone

CR 613.8b has no escape from the timestamp: the loop clause and the
simultaneous-dependents clause both fall back to it. Today most registry entries
are derived per read with synthetic stamps (`DERIVED_TIMESTAMP_BASE` and its
twins), whose documented purpose is to keep derived entries **below every minted
stamp** — so every static-ability effect sorts before every spell residue,
regardless of the timestamps CR 613.7a and 613.7b actually give them.

Building dependency on that base means an acceptance test cannot distinguish
"the dependency worked" from "the proxy happened to agree", and #2068 requires
each case to be proven under _both_ timestamp orders. So 613.8 waits for PRD
#2064 S6 (issue #3095), the slice that deletes the fields and the floors
together.

## Consequences

- `compareContinuousEffects` stops being the whole ordering answer and becomes
  the **within-group** answer. The five `entries.sort(...)` sites consume an
  ordered sequence instead of sorting.
- The `StaticEffect` union gains a read-set obligation: a new kind that ships
  without a row in the table is a `tsc` error, not a silent independent effect.
- `ContinuousEffect.characteristicDefining` (S1) becomes load-bearing rather
  than merely present. Its current values are correct but
  **catalogue-conditional**: one producer computes it, every other site
  hardcodes `false` on the argument that no layer-2-6 static effect kind in the
  catalogue is a characteristic-defining ability. Changeling (CR 702.73) is such
  an ability, defining subtypes in layer 4, and sits at `status: "planned"` in
  the Mechanics Registry. Clause (c) fails **open** the day it ships, so this
  work leaves a guard behind rather than a comment that was true once.
- Five cards must exist before the rule can be proven, because three of the four
  canonical dependency interactions are unbuildable from the current catalogue
  (issue #3098). Only Blood Moon + Urborg is assemblable today.
- The CR's two NON-dependency examples (under CR 613.9) become first-class
  acceptance cases, not footnotes. They are the canonical false-positive traps,
  and false positives are this design's characteristic failure mode.
- Making `applies` structural data — the only shape with neither false positives
  nor false negatives — stays available as the escalation path if the oracle
  shows the table failing in practice. It is 295 rewritten declarations and its
  own ADR, and it is deliberately not attempted here.
- CR 611.3 rules-modifying effects are untouched: they are outside the layer
  system and have no dependency ordering, per ADR 0082 decision 2.
