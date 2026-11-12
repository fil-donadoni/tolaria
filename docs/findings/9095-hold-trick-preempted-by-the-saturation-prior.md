---
title: The hold-trick root rule stops deciding its own test position once the Saturation Prior is on
discoveredBy: 9095
status: draft
confidence: medium
---

**What is wrong.** Nothing is wrong yet, but one root rule may have become
inert on the position its test uses. With the Saturation Prior on
(`saturationPriorTerms`, `convex/gre/search.ts`), the search reaches
`hold-trick`'s answer by itself on the blade entry "activation timing: holds a
sacrifice engine through its own main phase": `pass` on all five seeds, by
`material-tiebreak`. On the base the rule decides three of the five.

`rootRuleMoratorium.bot.test.ts` now reads the rule with the prior off
(`no-saturation-prior`), so it still proves the `no-rule:<mechanism>` plumbing.

**Evidence.** The hosted `must` census on `e767aee72` against its
`no-saturation-prior` arm (docs/research/reward-saturation-selection.md), and
the test before it was moved: `withoutRule.ok` true.

**Why it may not deserve its own issue.** Retiring a rule takes the two
measurements in `bot-development.md`: `flipped` = 0 over the decision-telemetry
corpus AND `BLADE_VARIANT=no-rule:hold-trick bun run test:blade` green. One
test position is not that evidence. If the two measurements agree, this
becomes a retirement ticket under the root-rule moratorium (ADR 0124 §5);
otherwise it is declined.
