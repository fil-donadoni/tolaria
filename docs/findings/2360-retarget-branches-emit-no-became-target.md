---
title: Copy-retarget and change-target branches write new targets without emitting BECAME_TARGET
discoveredBy: 2360
status: draft
confidence: medium
---

**What is wrong.** `BECAME_TARGET` (CR 601.2c) has five producers, all of them
target-ANNOUNCEMENT sites. Two further sites write `targets` onto a stack object
and emit nothing: the `"copy-retarget"` branch (a Fork-style copy choosing new
targets, CR 707.10c) and the `"retarget"` branch (a change-target effect, CR
115.7). Both make objects become the target of a spell or ability, so a
became-target trigger should see them — Ward (CR 702.21a) should tax a redirected
spell, Leovold should let its controller draw, and Dack Fayden's emblem (issue
#2360) would steal a Fork copy's targets in paper but does not here.

**Evidence.** `convex/gre/pendingTargetOrigin.ts:236-257` — the two branches
assign `copy.targets` / `spell.targets` directly with no
`emitBecameTargetEvents` call, unlike the trigger branch 15 lines below
(`:266-281`) which does emit. The producer census for #2360 enumerated all five
real emitters (`convex/gre/state.ts:9383`, `convex/game.ts:3123` and `:6344`,
`convex/gre/pendingTargetOrigin.ts:273`, `convex/gre/rules.ts:3204`); these two
are the only target-writing sites outside that set.

**Why it may not deserve its own issue.** A copy is not cast (CR 707.10), so
Dack's emblem is _correct_ to ignore the copy-retarget branch — the gap only
bites the "spell or ability" family (Ward, Leovold, Nadu) and only on the two
shipped retarget shapes. It may be one line on the ward/targeting tracker rather
than a ticket. It is also not obvious that the copy branch should emit at the
same moment as the announcement branch: CR 707.10c's target choice happens as the
copy is created, which is a different timing window than CR 601.2c.
