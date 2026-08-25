---
title: applyAllCombatDamage's step-level Fog short-circuit must be widened by every new "punches through prevention" mechanic
discoveredBy: 2231
status: draft
confidence: medium
---

**What is wrong.** `applyAllCombatDamage` skips the ENTIRE combat damage step
when a Fog is up, before any individual damage event is built. Its guard is a
hand-maintained conjunction of "does anything on the board override prevention",
and every new override mechanic has to remember to add itself. There are now two
terms, added by two different issues, and nothing fails when a third is
forgotten — the mechanic simply loses to a Fog while all of its own tests
(which never involve a Fog) stay green.

**Evidence.** `convex/gre/phases.ts:1180-1192`:

```ts
if (
    state.preventAllCombatDamageThisTurn &&
    !anyCombatDamageUnpreventableStatic(state) && // #2395, source-side
    !anyDamageLockOnBoard(state) // #2231, target-side
) {
    return;
}
```

`anyDamageLockOnBoard` (`convex/gre/state.ts`, beside `isDamageLockedTarget`)
was added only because a test written for the per-event path happened to also
put a Fog on the board. The per-event authority is
`applyOneCombatDamage`'s local `unpreventable` (`phases.ts:1246-1255`), which
already ORs both sources — so the step-level guard is a _duplicate_ of that
computation at board scope, with no structural link to it.

**Why it may not deserve its own issue.** The fix is small and local — one
exported `anyCombatDamagePreventionOverrideOnBoard(state)` predicate that both
the step-level guard and the per-event computation derive from, so adding a
third override is one edit instead of two. But there are exactly two terms
today and both are correct, so this is latent, not broken; it is arguably a line
on whichever tracker owns combat-damage prevention rather than a ticket of its
own. It becomes worth ticketing the moment a third override mechanic is
scheduled.
