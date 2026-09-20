---
title: A compiled damage head fires once per damaged recipient, not once per source
discoveredBy: 4131
status: draft
confidence: medium
---

**What is wrong.** `damage-dealt` (`convex/cards/compiledTriggers.ts`) never sets
`oncePerEventBatch`, and the engine emits one `DAMAGE_DEALT` per recipient
(`convex/gre/phases.ts`), so a creature blocked by two creatures triggers
"whenever this creature deals damage, you gain that much life" twice — two stack
objects and two life-gain events, where the rulings read one trigger for the
total. The hand-written Spirit Link / Zebra Unicorn twins behave the same way.

**Evidence.** Reviewer probe of the branch for issue #4131: `triggers.ts` fires a
non-batch ability once per matching event.

**Why it may not deserve its own issue.** Only an additive body (gain life,
draw) hides it — the life total coincides — and none of the twelve cards this
head made `ready` has a non-additive one. A line on whichever ticket first adds
a non-additive "that much" body.
