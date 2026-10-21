---
title: The cast gate reads only the first target group, so a spell with an empty later group is offered and then refused
discoveredBy: 6060
status: triaged
issue: 6210
confidence: high
---

**What is wrong.** `hasEnoughLegalTargets` (`convex/gre/rules.ts`, the
castability gate `getLegalActions` uses for the client's Cast affordance) checks
`def.targetRequirement` and `def.kickedTargetRequirement`. It never reads
`additionalTargetRequirements`. The cast announcement (`convex/game.ts`, over
`castAnnouncedTargetGroups` in `convex/gre/kicker.ts`) and the Bot's group enumerator (`enumerateTargetGroupTuples`,
`convex/gre/moves.ts`) both need EVERY group to have a legal target (CR 601.2c).
So a spell whose later group has nothing to choose gets offered to a human,
who is then refused at announcement: for example, "target blocking creature
fights another target blocking creature" with one blocker, or Fumarole's
"destroy target creature and target land" with no land to target. (A modal
spell with no card-level `targetRequirement` skips the gate entirely: it
returns `true` before reading any group.)

**Evidence.** Issue #6060's test (`botReachTarget.bot.test.ts`, "every target
group's combat role is posed"). Before the fix, the two-blocker pose returned
`getLegalActions(...).includes("cast") === true` and no `enumerateMoves` cast.
That gap is also why the Bot-reach sweep recorded Dissension in the Ranks as
`frozen › no-legal-move`. `classifyNoMove` (`convex/gre/ai/botReach.ts`) reads
"affordance present, no Move" as a Bot defect, but a human could not cast the
spell either, so the correct verdict was `position-unmodelled`. A Bot Gap
that is really a harness gap stays mislabelled until this is fixed.

**Why it may not deserve its own issue.** The cast is still refused
server-side, so no illegal state results. The cost is a dead Cast button and a
mislabelled sweep verdict. If the fix gets folded into a cast-gate cleanup, it
is one line on that tracker.
