---
title: 'CR 608.2b is cited for "an Op whose binding never bound does nothing", which is a target-legality rule'
discoveredBy: 2715
status: draft
confidence: high
---

**What is wrong.** Several bot-side comments cite `CR 608.2b` for the claim that
an effect over an empty or unbound set does nothing. Printed, 608.2b is about
TARGET LEGALITY only — "If the spell or ability specifies targets, it checks
whether the targets are still legal… if all its targets… are now illegal, the
spell or ability doesn't resolve." The cards it is cited on are untargeted, so
the rule does not reach them. The applicable rule is `CR 608.2c` (the
controller follows the instructions in the order written — an instruction over
an empty set does nothing).

**Evidence.** `convex/gre/ai/blade/registry.ts:1706` (Shallow Grave's note: the
`grantAbility`/`delayedTrigger` Ops "skip in turn (CR 608.2b)"; Shallow Grave is
untargeted) and `convex/gre/ai/__tests__/dominance.bot.test.ts:255` (the same
claim in the #2490 block header). Verified with `bun run cr 608.2b` and
`bun run cr 608.2c`.

**Why this is invisible to the gate.** `cr:lint` reds on an id that resolves to
nothing and on a `701`/`702` line naming the wrong keyword. A RESOLVABLE id that
is simply the wrong rule, outside those two blocks, is exactly the blind spot
its own header declares — so this class rots silently and gets copied forward
(this finding exists because a new comment in PR #3380 copied it before review
caught it).

**Why it may not deserve its own issue.** It is comment text: nothing behaves
differently, no test changes. If a sweep finds only these two sites it is a
one-line fixup on any PR that next touches either file rather than a ticket. It
earns a ticket only if a grep for `608.2b` across the tree shows the pattern is
widespread — which nobody has run.
