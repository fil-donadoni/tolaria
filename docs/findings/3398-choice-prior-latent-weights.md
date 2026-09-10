---
title: The choice-prior seam prices a card at the representative victim while the hand term prices it against the real board
discoveredBy: 3398
status: draft
confidence: medium
---

**What is wrong.** Issue #3398 made a targeted, board-affecting Op's latent
worth follow the board — but only through `evaluate`'s hand term. The OTHER
seam that values a whole, not-yet-cast card, `dslSearchLibraryPrior`
(`convex/gre/ai/choicePriors.ts:417`), still reads the context-free price: one
representative victim. So Demonic Tutor against an empty opponent board ranks
Stone Rain in the library at the flat `latent.boardRemoval` (160) while the
hand term, one node later, values the same card at 0. Two prices, one card,
one board.

The same wiring gap makes a **weight fit unmeasurable**: nothing sets
`ContextAwareResolvers.latentWeights`
(`convex/gre/ai/candidateValue.ts:747-771` builds the resolvers without it), so
a ladder variant sweeping `evalWeights.latent` moves the hand term and leaves
the choice priors on the production vector. The run then measures a mixed
policy rather than the vector it set — which is exactly what PRD #3397's
`Weight Fit` acceptance depends on being able to do.

**Evidence.** `convex/gre/ai/choicePriors.ts:417` calls
`contextAwareGroundingForChoice(state, choice.playerId)`;
`convex/gre/ai/candidateValue.ts:747` builds `ContextAwareResolvers` with
`resolveValue` / `resolveIsSelf` / `resolveForEachCount` and nothing else;
`convex/gre/ai/grounding.ts` then falls back to
`contextFreeLatentLens(resolvers.latentWeights)` with `latentWeights`
undefined. The same is true of `dslAbilityScriptValue` /
`dslRealizedAbilityScriptValue` (`convex/gre/cardValue.ts` → a bare
`contextFreeGrounding()`), which price a permanent's ability scripts.

**Why it may not deserve its own issue.** Neither half is a regression: the
prior read the fixed `DESTROY_VALUE` before issue #3398 too, so the change made
one seam better and left the other exactly as it was. Closing it means
threading `EvalWeights` from `search.ts` through `priorFor` into
`choicePriors` — a plumbing change across a seam issue #3398's `Target files`
does not name, and one better done once, for every context-aware consumer,
than card-by-card. It may belong as a slice under PRD #3397's `Weight Fit`
work rather than as a ticket of its own, since that is the only consumer for
which the mixed-policy half actually bites.
