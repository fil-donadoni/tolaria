---
title: opValuers.ts EXTRA_TURN_VALUE/SKIP_TURN_VALUE has already drifted from search.ts's value it claims to mirror
discoveredBy: 2683
status: draft
confidence: medium
---

**What is wrong.** `convex/gre/ai/opValuers.ts:116-117` sets
`EXTRA_TURN_VALUE = 300` and `SKIP_TURN_VALUE = 300`, sharing a name with
`search.ts`'s (now `EvalWeights.extraTurnValue`, issue #2683)
`EXTRA_TURN_VALUE = 350`. The two are already out of sync (300 vs 350)
despite the shared name implying they should track the same magnitude — a
card-quality valuer using one number and the root-selection structural
credit using another for "what an extra turn is worth".

Similarly `opValuers.ts:48` `LIFE_PER_POINT = 8` — its own comment claims it
matches `evaluate.ts`'s `W_LIFE` (now `EvalWeights.lifeWeight`), and today it
does (both 8), but nothing enforces that beyond the comment.

**Evidence.** `convex/gre/ai/opValuers.ts:48,116-117` vs
`DEFAULT_EVAL_WEIGHTS.lifeWeight` / `DEFAULT_EVAL_WEIGHTS.extraTurnValue`
(`convex/gre/ai/evalWeights.ts`, issue #2683).

**Why it may not deserve its own issue yet.** `opValuers.ts` was explicitly
out of scope for #2683 (file boundary — a parallel PR, #2297, owns it), and
folding these into `EvalWeights` is a separate, deliberate decision: they
value a DIFFERENT thing (a card's own script quality, evaluated once at
authoring time by a human-tunable heuristic) than the search's structural
extra-turn credit or the leaf's life term, and unifying them could just as
easily be the wrong move as the right one — a per-Op value model arguably
wants its own tuning surface, independent of the leaf evaluator's. Worth a
deliberate look once #2297 lands and this file is back in scope, not a
silent absorption into `EvalWeights` as a side effect of this refactor.
