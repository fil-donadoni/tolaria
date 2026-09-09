---
title: "Two live activations of one permanent are indistinguishable — the ability's stack item reuses the source's instance id"
discoveredBy: 2708
status: draft
confidence: medium
---

**What is wrong.** `buildActivatedAbilityStackItem`
(`convex/gre/activationCommit.ts:72`) is a `structuredClone` of the source
permanent, so the stack item KEEPS the source's instance id. That is
load-bearing and good (it is how a rider can name the permanent whose ability
was countered, CR 113.7a). The cost is that two simultaneous activations of the
SAME permanent produce two stack items with the SAME id, and every consumer
that addresses a stack object by id then aliases them:

- `SpellContext.counter`'s `state.stack.findIndex((s) => s.id === target.id)`
  counters whichever copy is lower in the stack, not the one targeted;
- `getLegalTargets` / `applyOneTargetSelection` offer and accept by that id, so
  the anti-spoof check cannot tell the two apart either;
- `src/components/board/game-stack.tsx` renders `key={item.id}`, giving React
  two siblings with one key.

Reachable with any permanent whose ability can be activated twice before
resolution — Icy Manipulator with two untaps is not it, but an ability without
a `{T}` leg (a repeatable mana-less pump, an activated ability paid with life
or counters) is.

**Evidence.** Found while writing issue #2708's tests: the sweep that pushes
two Icy Manipulator activations had to give the opponent a SECOND Icy
Manipulator, because with one permanent both stack items came back with id
`"icy"` and the offered-set assertion failed on an aliasing artefact rather
than on the filter under test
(`convex/cards/sets/inv/__tests__/blue.test.ts`, the `icy2` comment).

**Why it may not deserve its own issue.** It has presumably always been true
and nothing has reported a symptom, so the reachable-and-harmful intersection
may be empty in the current catalogue — the fix (allocate a fresh id for the
stack item and carry the source id in a field, the way triggers do) touches
every consumer that today relies on the alias, including issue #2708's own
`bindSource`. Worth pricing before ticketing: the question is whether any
SHIPPED ability can be activated twice with both copies on the stack at once.
