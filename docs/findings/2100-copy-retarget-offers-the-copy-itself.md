---
title: A copy's retarget offer lists the copy itself as a legal target
discoveredBy: 2100
status: draft
confidence: medium
---

**What is wrong.** CR 115.5: "A spell or ability on the stack is an illegal
target for itself." When a copy is offered new targets (CR 707.10c), the spell
branch of `getLegalTargets` does not leave out the copy being retargeted. Neither
the server finalization nor the client filters it out afterwards, so a "counter
target spell" copy can be pointed at itself.

**Evidence.** `convex/gre/rules.ts` (`getLegalTargets`, spell branch, ~:3275)
has no self-exclusion for the retargeted copy. `applyRaisedTargetFinalization`
accepts the choice. The client's `matchesTargetRequirement` marks it clickable.
Before issue #2100 the bug was reachable only with Fork plus a counterspell on
the stack. With Replicate shipped, every Lose Focus copy's retarget offer
includes the copy itself.

**Why it may not deserve its own issue.** It is one rule (CR 115.5) with one
exclusion to add at the shared target authority. It could be a line on the
copy/retarget tracker rather than a ticket, unless a second producer shows up
(Conspire, CR 702.78, inherits the same retarget path).
