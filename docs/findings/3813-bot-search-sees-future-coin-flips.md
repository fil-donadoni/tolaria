---
title: Bot search clones the PRNG state, so it foresees coin flips and shuffles
discoveredBy: 3813
status: draft
confidence: medium
---

**What is wrong.** A determinized search state keeps the real `rngSeed` /
`rngCounter` (`convex/gre/ai/determinize.ts` never reseeds). A simulated
`coinFlip` / `coinFlipSync` / `coinFlipSeries` or shuffle therefore draws
exactly the bits the real game will draw. On Squee's Revenge the Bot answers
the `number-pick` nomination (candidates 0, 1, 2, mid, max) by searching each
one, so it can choose exactly the number of upcoming wins: perfect foresight
of a random outcome.

**Evidence.** Surfaced by the issue #3813 review. `IGNORED_STATE_KEYS` covers
the rng fields for dominance only, not for simulation.

**Why it may not deserve its own issue.** It predates issue #3813 and affects
every random effect equally. It may already be an accepted ISMCTS
simplification: the fix (reseed per determinization) changes search results
across the board, so it wants a ladder measurement, not a slice.
