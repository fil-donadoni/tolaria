---
title: standing-spend-hold may be inert once body-funded shots leave the tree
discoveredBy: 3376
status: draft
confidence: medium
---

**What is wrong.** The root rule `standing-spend-hold` (issue #3319) may no
longer change any pick. The blade entry it was proven against, "activation
timing: does not shoot away its own last counter at the opponent's end step",
now holds with the rule disabled (`BLADE_VARIANT=no-rule:standing-spend-hold`,
one seed, measured in issue #3376). Before, the hold depended on the rule.

**Evidence.** Issue #3376 added `isSourceBodyDamageConversion`
(`convex/gre/search.ts`), which drops the bot's own shots paid out of its
body's counters from the rollout's ε draw and from the tree below the root.
The noise that made "shoot the last counter" look outcome-equal to `pass`
came from those shots, and it is gone. `rootRuleMoratorium.bot.test.ts`'s
end-to-end knob test therefore moved to `hold-trick`. In a one-seed scan of
the must tier, no entry is attributed to `standing-spend-hold`.

**Why it may not deserve its own issue.** Retirement needs two measures (ADR
0124 §5): `flipped` = 0 over the decision-telemetry corpus, AND the must tier
green under `BLADE_VARIANT=no-rule:standing-spend-hold`. Neither was run here.
The rule may still decide positions that the one-seed scan misses (other
seeds, non-Ballista standing spends such as sacrifice outlets). If it does,
this is nothing.
