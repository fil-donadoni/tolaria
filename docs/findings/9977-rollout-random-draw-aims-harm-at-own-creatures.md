---
title: The rollout's random draw aims harmful targeted moves at the mover's own permanents
discoveredBy: 9977
status: triaged
issue: 10376
confidence: medium
---

**What is wrong.** The rollout's epsilon branch (`rollout`, `convex/gre/search.ts`,
`rolloutEpsilon` 0.25) draws uniformly over the legal moves less a list of
sacrifice/exchange shapes. A targeted harmful activation is drawn at the mover's
own creatures as often as at the opponent's. A permanent holding many targeted
options (an Equipment with banked counters) costs its holder material at the
rate the draw lands on them, which biases rollouts against lines that bank such
options.

**Evidence.** Issue #9977 board, 100 rollouts after attacking with the Jitte's
host: 14% of them spent a counter on "-1/-1" at one of the bot's own Flying Men,
and the bot ended with 1.57 creatures on average against 1.86 after attacking
with the bare twin. Filtering misdirected siblings out of the random pool
(`withoutMisdirectedSiblings`-style, keeping a variant aimed right) moved the
rollout margin of "attack with the host" from 176 to 254.

**Why it may not deserve its own issue.** The tree-side prune the issue #9977
PR scoped to counter-paced activations fixed the decision without touching the
rollout. The random pool is meant to explore lines the greedy probe undervalues,
and the beneficence sign table still misreads some self-targets (Oko's +1 on
the bot's own artifact is a free body), so a filter here needs the same
measurement as the one the tree prune got.
