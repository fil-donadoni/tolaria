---
title: Necromancy's commented-out stub still lists gaps (a) and (b) as missing, but both landed with #2471/#2472
discoveredBy: 2473
status: draft
confidence: high
---

**What is wrong.** `convex/cards/sets/vis/black.ts:45-105`'s block comment
above the commented-out `necromancy` stub enumerates four blocking engine
gaps — (a) per-instance Aura enchant restriction, (b) cleanup-step
delayed-trigger boundary, (c) cast-timing memory, (d) self-granted-flash
permission (out of #1975's scope, tracked to #2146). While implementing
#2473 (gap c — now closed, comment updated in this PR), I found (a) and (b)
are **also already implemented**, closed by #2471 and #2472 respectively
(both `state: CLOSED` on the tracker) — but the comment's prose for those
two still reads as if the capabilities don't exist:

- Gap (a): `CardInstanceState.grantedEnchantRestriction` exists
  (`convex/gre/state.ts`, referenced in `convex/gre/sba.ts:139`), but the
  comment still says `checkAuraAttachmentSBA` reads only the compile-time
  `def.targetRequirement` and bails `if (!req) return false`.
- Gap (b): `next-cleanup-step` is a real `DelayedTriggerTiming` member and
  `CLEANUP`'s phase-entry handler calls
  `fireDelayedTriggers(state, "next-cleanup-step")`
  (`convex/gre/phases.ts:2085,2296`), but the comment still says
  `DelayedTriggerTiming` has "ten members and none is a cleanup one" and
  that the `CLEANUP` arm "never calls `fireDelayedTriggers` at all".

**Evidence.** `convex/cards/sets/vis/black.ts:69-90` (the full four-gap
enumeration); `convex/gre/sba.ts:139` (grantedEnchantRestriction consumer);
`convex/gre/phases.ts:2085,2296` (`next-cleanup-step` fire sites);
`gh issue view 2471` / `gh issue view 2472` (both `state: CLOSED`, parent
#1975).

**Why it may not deserve its own issue.** With gap (c) closed by this PR,
all three of #1975's actually-scoped gaps are now implemented — only gap
(d) (self-granted flash, explicitly out of #1975's scope, tracked to #2146)
still blocks Necromancy. The fix is a documentation-only rewrite of one
comment block, best done by whichever PR next touches this file (a natural
candidate: the agent shipping Necromancy itself, #2392, since it will
rewrite this whole comment into a real card definition anyway) rather than
a standalone ticket. I left it alone here rather than rewriting gaps (a)/(b)
myself because another session was concurrently working
`../tolaria-issue-2471-followup` against this same file when I ran — editing
the same paragraphs risked a needless merge conflict for a change outside
#2473's own scope.
