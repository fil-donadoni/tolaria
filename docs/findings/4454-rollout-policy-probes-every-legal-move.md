---
title: The rollout policy clones, applies and scores EVERY legal move on 75 % of plies — 8 to 117 probes per iteration
discoveredBy: 4454
status: draft
confidence: high
---

**What is wrong.** `selectRolloutMove` runs `cloneGameState` + `applyMoveInSearch`

- `policyValue` for every legal move when the rollout is greedy (p = 0.75).
  Measured 2026-09-23: 8 probes per iteration on an 8-move board, 117 on the
  49-move board; probes are 50–75 % of rollout time.

**Evidence.** `convex/gre/search.ts` `selectRolloutMove` (~2294–2311);
`docs/…` audit counts (`counts.ts`, 60 rollouts, load 23).

**Why it may not deserve its own issue.** Because it changes play. Pre-ranking
with the static valuers and probing the top-K, or memoising `policyValue` per
(world hash, move key) within an iteration, is a STRENGTH change (ADR 0021
rollout policy, ADR 0138 doctrine): it owes a ladder A/B and the full `must`
set, and issue #3593's history (a collapse flipped two `must` entries) is the
warning. Own PRD after PRD (b) #4454's perf fixture exists so the gain is
attributable.
