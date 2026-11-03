---
title: The scenario spec cannot seed or capture lifeLostThisTurn
discoveredBy: 3237
status: draft
confidence: low
---

**What is wrong.** `GameState.lifeLostThisTurn` (issue #3237) has no
`ScenarioSpec` field, unlike its twin `lifeGainedThisTurn` (issue #3453): a
preset cannot open on "the opponent already lost life this turn", and
`specFromState` reports the tally as dropped residue when a mid-turn position
is copied.

**Evidence.** `lifeGainedThisTurn` is lowered/seeded at
`convex/gre/scenarioBuilder.ts` (`seedSeatTally`, `specFromState`,
`GAME_STATE_ALLOWLIST`) and validated in `convex/debugScenarioSpec.ts` +
`convex/game.ts`'s spec validator; `lifeLostThisTurn` is in none of them.

**Why it may not deserve its own issue.** One card reads the tally today and
its preset reaches the state by playing (attack, then the 0); the residue
report is honest, not a silent loss.
