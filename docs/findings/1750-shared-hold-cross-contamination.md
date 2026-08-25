---
title: A departed suppressed grant's hold-cancellation can starve a still-live claimant that shares the same removedKeywords entry
discoveredBy: 1750
status: draft
confidence: medium
---

**What is wrong.** `releaseGrantedKeywordOccurrence` (`convex/gre/state.ts`)
now cancels the specific `removedKeywords` hold that outranked a `suppressed`
grant when that grant's source does a FINAL (non-transient) release (issue
#1750, part b). This is correct when the hold's escrowed unit traces
EXCLUSIVELY back to the departing grant's own occurrence — the shape the
issue itself describes and the shape every new test here covers.

It is provably wrong when the SAME hold's one escrowed unit is, at strip
time, fungibly shared with a printed keyword (or another still-live,
non-suppressed grant) that was ALSO live on `staticAbilities` when the
stripper took its one occurrence. `removedKeywords` entries are anonymous —
one hold records "one unit taken," never "taken FROM whom" — so once a
suppressed grant's own prior transient release has ALREADY spliced a live
occurrence during a `refreshCounterGatedStatics` round trip (leaving the
held unit to become, by fungible conservation, whichever OTHER claim is
still outstanding), cancelling that same hold on the grant's later final
departure takes back a unit that in fact belongs to the printed card or the
other grant. Concretely: the printed keyword never comes back even after
every stripper leaves.

**Evidence.** Traced by hand (not yet in a failing test — the trace itself is
the evidence, since building it needs a coincidental "condition/counter-gated
grant of a keyword the target ALSO has natively" shape no shipped card
produces): target has a printed keyword (1 live unit) plus a condition-gated
`keyword-grant` of the SAME keyword (2nd live unit). An unconditional
`keyword-remove` strips ONE unit (live=1, held=1). The grant's own
`refreshCounterGatedStatics` round trip later finds the board's outranking
hold, transiently splices the one remaining LIVE unit (live=0, held=1,
untouched) and reapplies `suppressed: true`. At this point the held unit is,
by elimination, the printed card's escrowed unit. If the suppressed grant's
source now leaves and the fix here cancels that hold, the printed keyword's
escrow is destroyed — when the stripper eventually leaves too, nothing
restores it, and the permanent is permanently missing a keyword it was
printed with.

`convex/gre/state.ts`'s `releaseGrantedKeywordOccurrence` (the `if
(grant.suppressed)` branch added by #1750) is the site; `unapplySourceStaticEffects`'s
`removedKeywords` block is where the eventual (never-fires, in this bad case)
restore would have lived.

**Why it may not deserve its own issue yet.** No shipped card can construct
this shape today: it needs a condition- or counter-gated `keyword-grant`
whose target can ALSO carry the same keyword natively (or from another live
source) at the moment a stripper applies — the catalogue currently has
exactly one condition-gated keyword-grant (Kavu Runner, self-targeting
`haste`, which no printed creature has natively) and the counter-gated shapes
are all `subtype-set`/`pt-buff`, not `keyword-grant`. The narrow, reachable
shape (no printed keyword, no other live source, matching this issue's own
narrative) is exactly what #1750's fix and tests cover; the fully general fix
would need the hold itself to record enough provenance (or a claim count) to
resolve the ambiguity, which is a bigger data-model change than this issue's
scope. Worth a line on a future keyword-occurrence-model tracker if one of
these grants ever ships against a target that can carry the keyword natively.
