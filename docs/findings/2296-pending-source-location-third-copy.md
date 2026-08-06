---
title: getPendingTargetSourceSupertypes re-implements pendingTargetingSource's source-location switch
discoveredBy: 2296
status: draft
confidence: medium
---

**What is wrong.** `convex/gre/rules.ts` carries the "where does the pending
source live" switch — `copy-retarget`/`retarget`/`trigger` → the stack item;
`ability` → a battlefield permanent; `cast` → a hand card — in **two** places,
verbatim. `pendingTargetingSource` (the constructor every production consult
site is supposed to use) has it, and `getPendingTargetSourceSupertypes` has an
identical copy. A future zone/kind (a graveyard-cast source, a `foretell`
window, a fourth raised origin) has to be added to both, and the compiler
cannot say so: both are plain `switch`-shaped expressions over the same
`kind` union, returning different types.

**Evidence.** `convex/gre/rules.ts:2101-2106` (`pendingTargetingSource`) and
`convex/gre/rules.ts:2544-2549` (`getPendingTargetSourceSupertypes`) — the
same four lines of `state.stack.find(...)` / `state.players.flatMap(...)`.
This is the shape that produced issue #1120's review round 1: the offered side
read supertypes from one derivation and the accepted side from another, and
they disagreed for `kind: "trigger"`. The `TargetingSource` bundle fixed the
_dimension_-dropping half of that class; the _location_-drifting half is still
duplicated. Its three sibling helpers (`getPendingTargetSourceColors` /
`…Types` / `…Subtypes`, per the doc comment at `rules.ts:2530`) presumably
carry the same copy.

**Why it may not deserve its own issue.** Both copies live in the same file,
twenty lines apart, and are currently identical — the drift is latent, not
present. The cheap fix is to have the `getPendingTargetSource*` family read
`pendingTargetingSource(...)` and project a field off it, which is a ~10-line
refactor that could equally ride the next ticket that touches this file rather
than earning a ticket of its own. It is also possible the family is dead code
for two of the four helpers, in which case the answer is deletion, not
de-duplication — worth checking before ticketing.
