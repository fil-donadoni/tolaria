---
title: Delayed triggers bypass placeTriggersOnStack, so they are never APNAP-ordered with the batch they fire alongside (CR 603.3b)
discoveredBy: 2472
status: draft
confidence: medium
---

**What is wrong.** `fireDelayedTriggers` pushes its stack items **directly**,
while every other trigger source goes through `placeTriggersOnStack`, which is
where CR 603.3b's "if a player controls two or more of them, that player chooses
the order" prompt lives. Two batches that trigger at the same moment and share a
controller are therefore never ordered together: the delayed ones land
unconditionally on the bottom, with no ordering choice offered.

**Evidence.** `convex/gre/phases.ts:2306` fires the `next-cleanup-step` delayed
instances inside `finalizeCleanupDiscard`; `convex/gre/phases.ts:2314` then runs
the Madness batch collected off the same CR 514.1 discard through
`placeTriggersOnStack`. Both sets are simultaneous triggers of the same
controller inside one CR 514.3a check. `convex/gre/phases.ts:1762`
(`fireDelayedTriggers`) has no `placeTriggersOnStack` call on any path.

**Pre-existing, newly exercised.** The shape is as old as `fireDelayedTriggers`
— its own doc already admits ordering is not implemented — but #2472 is what
makes two batches collide in a single step for the first time, because the CR
514.1 discard (Madness) and the cleanup-step delayed timing now resolve in the
same window.

**Why it may not deserve its own issue.** Reaching it needs a player to control
BOTH a `next-cleanup-step` delayed trigger and a Madness discard in the same
cleanup step, and no shipped card uses `next-cleanup-step` at all yet. The fix is
also not local: `fireDelayedTriggers` would have to stop pushing and start
returning items so its caller can merge them into one `placeTriggersOnStack`
batch — six timings and every call site, for an ordering choice that is
observable only when the two batches interact. Better as a line on the delayed-
trigger tracker than a ticket, until a card makes the collision reachable.
