---
title: The informed sampler recomputes the Unseen Remainder from the same root on every ISMCTS iteration
discoveredBy: 2878
status: draft
confidence: medium
---

**What is wrong.** The informed path's extra cost over the blind one isn't the
shuffle. `determinize` gets the same `rootState` on every iteration
(`convex/gre/search.ts`, the `determinize(rootState, …)` call at the head of
each iteration). Each call still runs `unseenRemainder`
(`convex/gre/deckKnowledge.ts`) from scratch: one pass over the decklist, then
over every battlefield, graveyard, exile, phased-out bundle and the stack. The
public state it reads is the root's, so the result is identical every time.

**Evidence.** A scratch bench on a 60-card decklist, with the opponent at 7
hand and 49 library slots, 4 public permanents and 7 reps (median). Per call:
`determinize` costs 31.3 µs blind and 37.8 µs informed (+21%). Of the
≈ 6.5 µs gap, `unseenRemainder` is 2.2 µs and hydrating 56 imagined cards
(`tryGetDefinition` plus the object literal) is ≈ 1.0 µs. The shuffle is
1.65 µs, and the blind path pays it too. With hand + library covering the whole
remainder (56 = 56), the partial Fisher-Yates from issue #2878 draws all of it,
so the change cannot be measured there. That much was expected.

**Why it may not deserve its own issue.** It is ≈ 2 µs on an iteration that
costs milliseconds once the rollout runs (the informed and blind arms differ by
far more than that because the opponent plays different cards). Caching the
remainder per root also crosses into `search.ts` and the Brain worker's
deck-knowledge plumbing, for a small share of the iteration. It is worth doing
only if a profile of the full iteration shows the sampler on top.
