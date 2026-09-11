---
title: applyMoveForSearch's cast branch passes the INPUT state to removeFromZone, mutating what its docstring calls pure
discoveredBy: 3000
status: draft
confidence: high
---

**What is wrong.** `applyMoveForSearch` clones (`const next =
cloneGameState(state)`) and binds its player and cast source out of `next`, but
its cast branch calls `removeFromZone(state, castSource.owner, …)` with the
ORIGINAL `state` as the first argument. That argument exists only to reach the
Continuous Effects Registry for the battlefield-transient reset, and
`resetBattlefieldTransientState` → `purgeContinuousEffectsForInstance` WRITES
`state.continuousEffects`. So a search apply mutates its input, against the
function's own docstring ("Pure: `state` is not mutated"), and the purge lands
on the wrong state object — the clone keeps rows for an instance that is no
longer on its battlefield.

**Evidence.** `convex/gre/applyMove.ts` — the `removeFromZone(state, …)` call
in the cast-spell branch, with `next` cloned above it and `castSource` bound out
of `next`. `convex/gre/search.ts`'s twin has the same shape but passes `state`
consistently throughout and mutates in place by contract, so only the
`applyMove` copy is wrong. Pre-existing; issue #3000 only added the fifth
argument to this call.

**Why it is not fixed in issue #3000.** One word (`state` → `next`), but it is
a BOT behaviour change on a `BOT_GLOBS` path — the clone would start receiving
the purge and the input would stop — which owes its own blade declaration and
belongs nowhere near a controller-stamp bug fix.

**Why it may not deserve its own issue.** Defensible without the diff that
surfaced it (a search apply that mutates its input is a bug on its own terms),
and cheap. What it needs is a discriminating blade pair or a unit test that
observes the leak, which is most of the work.
