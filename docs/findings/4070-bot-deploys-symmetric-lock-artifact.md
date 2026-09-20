---
title: the Bot casts Winter Orb into its own five-land board on search alone
discoveredBy: 4070
status: draft
confidence: medium
---

**What is wrong.** With five untapped Swamps, Winter Orb in hand and a
symmetric board (one Grizzly Bears, Ornithopter and Castle a side), the Bot
casts Winter Orb — "players can't untap more than one land during their untap
steps" — on 3 of 5 seeds at 200 iterations. The lock costs the Bot's own mana
as much as the opponent's.

**Evidence.** A blade probe of that position (`forbidden: cast Winter Orb`,
budget 200, seeds 0xb1ade / 1 / 2 / 3 / 4) chose the cast on seeds 1, 2 and 4.
The result is the same with `BLADE_VARIANT=no-rule:free-development` and with
the rule's ability clause in place, so it is the search's own pick and not a
tie-break's: the effect lives past the rollout horizon (ADR 0015), so the
evaluator sees a body-less artifact for `{2}` and nothing else. Issue #4070's
review found the same shape for Howling Mine (each player draws), which was
not measured here.

**Why it may not deserve its own issue.** Only symmetric static and trigger
permanents reach it, and the catalogue has a handful. Whether a lock is good
depends on who is ahead on lands, which is a valuation term for a future
symmetric-effect pass, not a fix for one card. It is a line on the Bot roadmap
map (issue #1892) until a real game shows the Bot locking itself out.
