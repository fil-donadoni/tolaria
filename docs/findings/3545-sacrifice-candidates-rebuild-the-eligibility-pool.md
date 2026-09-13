---
title: sacrificePermanentsCandidates rebuilds the zone-pick eligibility pool instead of calling eligibleZonePickCards
discoveredBy: 3545
status: draft
confidence: low
---

**What is wrong.** Issue #3545 promoted the submit-path eligibility mirror to
`convex/gre/zonePickEligibility.ts` (`eligibleZonePickCards`). Both
`legalActions.ts` and the new `choose-permanents` generator now read it.
`sacrificePermanentsCandidates` (`convex/gre/ai/choiceCandidates.ts`) still
builds its own pool: one player's battlefield, the allow-list and
`matchesPermanentFilter` over the effective view. That is the only copy of the
predicate left.

**Evidence.** Compare the `pool` construction in `sacrificePermanentsCandidates`
with `eligibleZonePickCards`. The two agree today because a sacrifice can never
reach a permanent its chooser does not control (CR 701.21a, and
`effects/validate.ts` refuses `allControllers` on a sacrifice pick).

**Why it may not deserve its own issue.** The private rebuild is correct for a
single-player sacrifice pool, and nothing diverges yet. It becomes a bug only
if the submit path's per-id validation gains a clause (like `untap-pick`'s) and
the copy is not updated with it. Routing it through the shared function is a
one-line change the next person touching that generator can make.
