---
title: An ability activated by a non-controller puts a stack item on the stack claiming the permanent's controller
discoveredBy: 3000
status: draft
confidence: medium
---

**What is wrong.** `buildActivatedAbilityStackItem` spreads the source
permanent and stamps `castById` without restamping `controllerId`, so an
ability activated by a player who does not control the permanent
(`activatableByAnyPlayer` / `activatableByOpponentsOnly`) sits on the stack
with `controllerId` naming the permanent's controller rather than the
activator. CR 113.7a: the controller of an activated ability on the stack is
the player who activated it. Five shipped cards reach it (`arn/green.ts`,
`atq/colorless.ts`, `ice/colorless.ts`, `ice/white.ts`, `leg/white.ts`).

This is the exact "two fields disagreeing about the same fact" shape issue
#3000 closed for SPELLS, one object kind over.

**Evidence.** `convex/gre/activationCommit.ts` —
`buildActivatedAbilityStackItem`'s literal sets `castById: commit.castById`
over a `{ ...card }` spread and never touches `controllerId`. Contained today
because `buildSpellContext` sets `controller: item.castById` and all five
shipped abilities affect only `$source`, so nothing downstream reads the stale
field — the `sourceControllerId = item.castById ?? item.controllerId` read in
`gre/state.ts` is deliberately ordered to survive exactly this.

**Why it may not deserve its own issue.** Zero observable symptom today: it
needs one of the five cards AND an ability clause that reads "you"/"you
control" against something other than its own source. It is a one-line stamp
whenever someone is next in that file, or a line on a CR 113.7a tracker.
