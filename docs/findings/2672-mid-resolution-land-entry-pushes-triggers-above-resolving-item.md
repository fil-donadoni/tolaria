---
title: A land that settles mid-resolution pushes its entry triggers above the resolving item, which the resolution then pops or resumes into
discoveredBy: 2672
status: draft
confidence: low
---

**What is wrong.** `settleEnteredLand` (`convex/gre/playLand.ts`) ends with
`processPendingActionTriggers`, which pushes the land's entry triggers
(landfall, for example) onto the stack at once. When the land is played
mid-resolution (`playLandForPlayer` — Word of Command, the hideaway play),
those triggers land ABOVE the item that is still resolving. Two readers then
assume the resolving item is on top:

- the spell / triggered branches of `resolveTopOfStackInner`
  (`convex/gre/state.ts`, the final `state.stack.pop()` near lines 2903 / 3022)
  would pop the fresh trigger instead of the resolving item (read from the code,
  not reproduced);
- `resumeAfterStagedEntry` (`convex/gre/asEnters.ts`) checks only that the
  parked item is still on the stack, then calls `resolveTopOfStack`, which would
  resolve the new trigger with no priority round. Issue #2672 made a played land
  a staged entry (origin `"play"`), so this path now exists for a land that owes
  as-enters choices and settles without a pay-choice.

**Evidence.** Surfaced by the issue #2672 review. Suggested hardening: resume
only when `state.stack.at(-1)?.id === parkedStackItemId`, or hold the trigger
flush while a resolution is suspended.

**Why it may not deserve its own issue.** Nothing shipped reaches the as-enters
half: Multiversal Passage, the only land declaring `entersWith.asEnters`, always
parks on its pay-choice, so it never settles inside the resolution. The older
pop half needs a mid-resolution land play beside a landfall source on the same
side, and it is unproven: the first step is a test.
