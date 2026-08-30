# A materialised static effect may ride the existing refresh sweep while the Continuous Effects Registry is unbuilt

## Status

accepted

## Context

ADR 0082 diagnosed the engine's split between two models for continuous
effects — layer 7 recomputed at every read, layer 6 materialised once by
`applySourceStaticEffects` — and decided on one `continuousEffects` registry as
the single source of truth. That ADR is `proposed`, and its own decision 5
scopes it as a core-engine rework with its own PRD (#2064): 202 server call
sites read `.staticAbilities` directly, 295 `staticEffects` declarations across
134 card files.

Decision 5 also settled what its consumers do in the meantime, and it named
exactly two options: a capability that needs a recomputable effect **waits**
(Pledge of Loyalty, #1329, declares a dependency on the PRD), and one that
needs only DSL additions **ships independently** (Winnow, Pure Reflection).

Agatha's Soul Cauldron (#1324 / #2943) is neither. Its clause "creatures you
control with +1/+1 counters on them have all activated abilities of all
creature cards exiled with this" needs a layer-6 grant whose recipient set is
counter-gated and whose ability set varies with a linked-exile pile that
changes at instant speed. Read against decision 5 it looks like a card that
must wait for a PRD-scale rework.

That reading is wrong, and the reason matters. Layer 6 is not purely
materialise-once today: `refreshCounterGatedStatics` (`convex/gre/state.ts`)
already unapplies and re-applies a source's grants with `preserveTimestamp`,
driven from the two counter mutators and from `checkStateBasedActions` as the
catch-all for every stable transition. It shipped for issue #1711 and was
generalised once already for #1095. A grant that declares a dependency on live
state is therefore re-derived by machinery that **already exists**, not by a
new one.

What ADR 0082 actually rejected was narrower than "anything dynamic before the
registry". It rejected `dynamicKeyword: (source, ctx) => string` — a closure
evaluated at the point the keyword is **consulted**. That is a genuinely
second notion of liveness, parallel to the CR 613.7 timestamp machinery and
invisible to it. Re-running an `applies` predicate inside the existing sweep is
the same notion, on the same timestamps, through the same code path.

One further problem is already documented in that function and has been
deferred twice. Its gate is a hand-kept disjunct list, and the code says so:

> the second disjunct is a NARROW, kind-specific special case … Harmless
> today — no OTHER materialized static-effect kind exposes `condition` — but
> the next one that does will silently need its own disjunct added here, or it
> ships inert exactly like the bug class this function exists to fix

Cauldron is the third such kind. A third hand-written disjunct is the point at
which the list stops being a special case and becomes an unenforced contract.

## Decision

**A materialised layer-6 static effect may declare a dependency on live state
and be re-derived by `refreshCounterGatedStatics`, without waiting for the
Continuous Effects Registry.** ADR 0082's rejection stands where it was aimed:
recompute-at-consult remains barred, and no effect may introduce a liveness
mechanism outside the existing sweep.

**The sweep's gate becomes a declared, census-guarded contract rather than a
hand-kept disjunct list.** `refreshCounterGatedStatics` asks one question of
each effect; the exhaustive kind census in
`convex/cards/__tests__/counterGatedStatics.test.ts` — which already classifies
every kind as `materialized` / `recomputed` / `materialized-unrefreshable` and
is derived rather than hand-listed — is what forces a new dynamic kind to
answer it. A kind that declares nothing reds the census instead of shipping
inert.

Three boundaries keep this from becoming a licence:

1. **Only the existing sweep.** A capability that cannot be expressed as
   "re-run this predicate on a stable transition" is not covered by this ADR
   and still waits for #2064. A keyword whose _parameter_ must be recomputed —
   Pledge of Loyalty's protection colour set, the case ADR 0082 was written
   against — is exactly such a capability: #1329 still waits.
2. **The declaration is on the effect, not in the sweep.** Nothing may be
   added to a disjunct list in `refreshCounterGatedStatics` again.
3. **Timestamps are untouched.** A re-derivation keeps `preserveTimestamp`
   (CR 613.7 — a re-evaluation is not a new application), so the ordering
   hardening from #1715 continues to hold across an arbitrary number of SBA
   passes.

## Consequences

- Cauldron's ability-copy ships without blocking on a PRD-scale rework, and
  without the second liveness mechanism ADR 0082 exists to prevent.
- PRD #2064 acquires these kinds as migration surface: an effect declaring a
  live-state dependency is one the registry must absorb, and the declaration is
  the list of what to absorb. It is a smaller debt than an undeclared one — the
  migration can enumerate them rather than discover them.
- The staleness bug class `refreshCounterGatedStatics` was written to fix
  (`convex/gre/state.ts`, issues #1711 / #1095) stops being re-openable by
  omission. That is a strict improvement over today independent of Cauldron.
- The sweep's cost profile is unchanged: it is still a no-op scan of the
  battlefield for any board whose sources declare nothing.
- This ADR does not accept or amend ADR 0082, which stays `proposed`. It
  narrows what "wait for the registry" means for a consumer, nothing more.
