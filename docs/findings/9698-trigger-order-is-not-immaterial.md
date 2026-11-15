---
title: The search answers trigger-order with one canonical order, but some orders matter
discoveredBy: 9698
status: draft
confidence: medium
---

**What is wrong.** `triggerOrderCandidates` (`convex/gre/ai/choiceCandidates.ts`)
offers ONE answer to a `trigger-order` choice: the slice in collection order. Its
comment says "self-ordering one's own triggers is tactically immaterial". That is
false when one trigger changes what another does. A bounce land entering tapped
beside Amulet of Vigor raises two own triggers (CR 603.3b): Amulet's "untap it"
and the land's "return a land you control to its owner's hand". With the untap on
top, the land is untapped while the return waits, so it can be tapped for mana in
response and then returned. With the return on top, the land is picked or kept
while still tapped.

**Evidence.** On the issue #9698 position (Amulet of Vigor, a Forest, Simic Growth
Chamber played), the collection order happens to put the untap on top, so the
blade entry `bounce land: Amulet of Vigor's untapped bounce land taps for mana
before its return resolves` is green. Nothing guarantees that order: it follows
the battlefield scan, and the opposite order would make the float unreachable.
The entry reaches its decision through the new `order-triggers` setup step, which
names the order explicitly, so the entry does not exercise the Bot's own ordering.

**Why it may not deserve its own issue.** Offering every permutation multiplies
the branching of every trigger batch, which is what the one-candidate rule
avoids. A cheaper fix is two candidates (the collection order and its reverse)
for a two-trigger slice. Whether that is worth it depends on how often an
order-sensitive pair occurs in the Targets. Today the Amulet + bounce land pair is
the only one a level-2 row names.
