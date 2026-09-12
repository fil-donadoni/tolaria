---
title: the choice surface prices its candidates at the committed vector, so a SearchVariant latent override is half-applied
discoveredBy: 3406
status: draft
confidence: medium
---

**What is wrong.** Issue #3406 threaded the latent vector through the card
valuation chain, so `evaluate(state, botId, W)` is now a function of `W`. The
CHOICE surface was left out: `candidateValue.ts` takes no weights at all, so
the worth it puts on a library/graveyard candidate is priced at
`DEFAULT_EVAL_WEIGHTS` no matter which vector the search is running. A
`SearchVariant.evalWeights` ladder arm that lowers, say, `latent.recursion`
therefore changes the leaf evaluation and NOT which candidates the choice node
admits — so the arm measures a half-applied vector and the ladder attributes
the result to the whole one.

**Evidence.** `convex/gre/ai/candidateValue.ts:268` calls
`latentGraveyardValue(card)` with no vector, and `:340` reaches it through
`libraryTargetWorth`, which `convex/gre/ai/choiceCandidates.ts` (top-K
admission) and `convex/gre/ai/choicePriors.ts` (ordering) both consume — both
inside `settleStackForBreakdown`, hence inside `policyProbeState`. The sibling
seam is `convex/gre/ai/grounding.ts:312`: `contextAwareGrounding` reads
`resolvers.latentWeights`, and no producer anywhere sets that field, so every
context-aware valuation prices at DEFAULT too (already written up in
`docs/findings/3398-choice-prior-latent-weights.md`).

**Why it may not deserve its own issue.** It cannot reach the Weight Fit's
derivative probe, which is what made issue #3406's half urgent: the probe
settles ONCE at the base vector and then re-scores that fixed settled state
under each bumped vector (`convex/gre/ai/verdicts/evalPairs.ts:98`,
`verdicts/features.ts:254`), so a weight-blind settle is a constant across the
bumps and the basis is unaffected. The cost is confined to variant runs — the
ladder and any future per-arm weight experiment — which may make it a line on
the existing #3398 finding rather than a ticket of its own.
