---
title: Retargeting a copy of a multi-group spell overwrites its later target groups
discoveredBy: 5703
status: draft
confidence: medium
---

**What is wrong.** `requestCopyRetargetOn` / `offerRetargetUnlessForced`
(`convex/gre/state.ts`) build only the first target group of a copied spell, and
`applyRaisedTargetFinalization` (`convex/gre/pendingTargetOrigin.ts`) then
overwrites the whole of `copy.targets` with that group's picks. A spell with a
second announced group (Reap: the opponent, then up to X graveyard cards) loses
the second group when its copy is retargeted: the opponent casts Fork on Reap,
the copy's controller picks the "target opponent" and the copy returns nothing.
CR 707.10c lets the copy's controller choose new targets for each target and
the copy keeps the number of targets it was copied with.
`determinedMax: copy.targets.length` is also a total over all groups, not a per
group bound, which is harmless only while the first group has a fixed count.

**Evidence.** Surfaced by the review of issue #5703's Reap rule; Reap is the
first shipped card whose second group is bounded by a `TargetCountQuantity`.

**Why it may not deserve its own issue.** The machinery predates Reap and
only a multi-group spell with a copy effect reaches it; one card today. If no
second card appears it is a line on the copy-retarget tracker rather than a
ticket.
