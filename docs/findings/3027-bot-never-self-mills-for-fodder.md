---
title: the Bot never mills ITSELF for escape fodder — the leaf prefers it, the rollout policy cannot realise it
discoveredBy: 3027
status: draft
confidence: high
---

**What is wrong.** Half of a real Underworld Breach line is to point Brain
Freeze at **your own** face first: the self-mill fills the graveyard with escape
fodder and puts a spell on the stack for storm, and only the SECOND Brain Freeze
goes at the opponent. The Bot never does the first half.

**What is NOT the problem.** After the three fixes in this branch the LEAF
evaluation already prefers the self-target. Measured, Breach + Black Lotus +
Brain Freeze, my library 40, opponent's 12:

| graveyard | self-target | opponent-target |
| --------- | ----------- | --------------- |
| 0         | **93.0**    | 69.0            |
| 4         | **153.0**   | 129.0           |
| 8         | **213.0**   | 189.0           |

The `graveyard` term pays +60 per unlocked escape and the `library` term is
exactly zero for a 40-card library, so self-milling is correctly the better
immediate position — by +24 in every case.

**The search still never picks it.** Deterministic across three seeds at every
budget measured:

```
gy=0 iters=  400 / 1600 / 6400 / 25600 : cast Brain Freeze -> opponent  (3/3 seeds each)
gy=8 iters=  400 / 1600 / 6400         : cast Lightning Bolt [from graveyard]
gy=8 iters=25600                       : cast Brain Freeze -> opponent
```

64× the production budget does not find it, and the pick is stable rather than
drifting — so this is not a budget the loop is one notch short of.

**Why.** The self-mill's payoff is not in its own leaf, it is six correct moves
later (escape, tap, escape, tap, storm-count, kill). The backed-up value comes
from ROLLOUTS, and the rollout default policy plays greedily; it will not
execute a specific deterministic combo, so the subtree below the self-mill
scores like the subtree below anything else and the +24 leaf edge is washed out.
Compounding it slightly, Brain Freeze is an Instant, so casting it at sorcery
speed is `isDiscouragedRolloutMove` (ADR 0021) — a default-policy headwind that
applies to BOTH targets equally, so it explains the noise but not the
preference.

**Why it may not deserve its own issue.** The generic fix is a large one — a
planner or a combo-aware rollout policy — and ADR 0102 explicitly rejects a
per-card combo registry, which is the cheap version. The narrow fix (a rollout
policy that follows a known engine loop) is a real design question, not a
ticket. Against that: this is the same shape as every storm / graveyard-loop
deck, the leaf is now provably pointing the right way, and the gap is precisely
localised to the rollout policy rather than to valuation — which is the most
actionable a "the bot cannot combo" finding has ever been in this repo.
