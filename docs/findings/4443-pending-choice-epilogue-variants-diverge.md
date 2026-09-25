---
title: Pending Choice resume epilogue differs by family (copy-retarget hand-off, SBA sweep)
discoveredBy: 4443
status: draft
confidence: medium
---

**What is wrong.** The resolve/priority epilogue that every Pending Choice
answer returns into (`resumeAfterChoice`, `convex/gre/pendingChoiceResume.ts`)
takes two flags, because the copies it replaced did not agree:

| Family                                           | `pendingTarget` hand-off | SBA sweep |
| ------------------------------------------------ | ------------------------ | --------- |
| may-pay, name-card, number-pick, random-reveal   | yes                      | yes       |
| choose-player, option-pick, pick-pile            | no                       | yes       |
| choose-damage-target, the generic zone-pick tail | no                       | no        |

When a resumed resolution raises a copy-retarget (`pendingTarget`, the
Fork-shaped case the may-pay copy comments on), the families without the
hand-off give priority to the active player instead of the retarget's chooser.
Nothing on record explains the difference. It looks like copy drift, not a
decision.

**Evidence.** The flags are set per handler in
`convex/gre/pendingChoiceSubmitHandlers.ts` and in `RESUME_WITH_RETARGET`
(`convex/gre/pendingChoiceSubmit.ts`). Issue #4443 kept every family exactly as
it shipped, because its contract was "no behaviour change".

**Why it may not deserve its own issue.** No shipped card may reach the
divergent path: a zone-pick followed, in the same resolution, by a
copy-retarget. Unifying on `{ true, true }` is a one-line change once a test
shows the zone-pick family resuming into a `pendingTarget`.
