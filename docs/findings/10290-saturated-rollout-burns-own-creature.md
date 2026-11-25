---
title: Past the reward clip the rollout's greedy pick casts creature-only removal on the mover's own creature
discoveredBy: 10290
status: draft
confidence: medium
---

**What is wrong.** `selectRolloutMove` (`convex/gre/search.ts`) ranks candidates
by the clipped reward. Past `materialFull` every candidate ties, so the pick is
random. With removal in hand and no opposing creature left, the tie is between
`pass` and the removal on the mover's own creature. The line that killed the
last target is the one that crosses the clip, so its rollouts are the ones that
burn the mover's own board, and a line that leaves the target alive reads better.

**Evidence.** Three Galvanic Discharge in hand, three Mountains, an Ocelot Pride
in play, two opposing Islands and a Maritime Guard as the only opposing creature,
0 energy: at 400 iterations the Bot pays 1 of 3 energy on seeds 1 to 3 (seed 1:
mean margin 389 for paying 1, 243 for paying 3). With greedy play from the paid-3
state (margin 568) it casts a Discharge on its own Ocelot Pride (-55 margin) and
later on the Cat. With one copy or none of the Ocelot Pride the position plays 3.

**Why it may not deserve its own issue.** This is the far-ahead coin flip ADR
0176 measured: a compressive tail in the rollout policy fixes it and flips 7 to 8
of 540 `must` entries. A narrower fix would break the tie by the unclipped value
at the greedy pick only, and owes the same full-blade measurement.
