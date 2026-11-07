---
title: A dies-trigger's targeting source reads the dead object's printed characteristics, not its last known ones
discoveredBy: 2179
status: draft
confidence: medium
---

**What is wrong.** A trigger whose source has already left the battlefield is
built from the card in its new zone, so `targetingSourceFromCard`
(`convex/gre/rules.ts`) judges protection against that card's printed
characteristics. CR 608.2h and CR 113.7a point at the object as it last existed.
A creature made black by a continuous effect that dies and targets a creature
with protection from black is offered that target.

**Evidence.** Read from the code, not reproduced by a test, and no shipped card
was found that hits it. `item.sourceLki` is written at departure only for an
ability already on the stack, while `collectTriggers` builds a later trigger from
the post-departure card. `types` has read printed there since the type-line
revert; the colours, subtypes and supertypes read printed since `revertTypeLine`
and `revertColorChanges` run on every departure.

**Direction.** Snapshot the source's characteristics at departure for triggers
collected after it, the way `lkiTypes` and `lkiSubtypes` already reach the leave
events.
