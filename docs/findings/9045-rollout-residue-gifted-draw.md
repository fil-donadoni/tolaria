---
title: The rollout default policy rewards gifting three cards to an opponent who is already far ahead
discoveredBy: 9045
status: draft
confidence: medium
---

**What is wrong.** In the reconstructed issue #8954 position (report
`nd77dmd2w9xnh5rg0d23r7gvj58hvyfv`, the prepared Ancestral Recall copy back
in exile, priority to the Bot) the ROLLOUTS rank "they draw three" above "I
draw three" at every budget measured — 600 and 3 000 iterations, seed 1 —
and the gap grows with budget (ADR 0176: 0.237 against 0.210, then 0.233
against 0.217). The one-ply Evaluation ranks them the right way round by a
wide margin (0.60 against 0.29 on the reward scale at the root, this pass's
trace). ADR 0176 ruled out the leaf clip and the random rollout opponent as
the cause: leaves on the compressive tail with the rollout policy on the
clip still rank the gift first, and ranking the policy by the raw `evaluate`
value does not fix it either. So the residue is in the rollouts themselves:
an opponent with three more cards in hand kills the Bot LESS often inside
the horizon than the same opponent without them.

**Evidence.** `convex/gre/search.ts` — `selectRolloutMove` (the greedy
one-ply default policy, `rolloutEpsilon` 0.25 of uniform-random moves) and
`rollout` (the horizon). ADR 0176 § What was measured, items 2 and 4. The
Root Heuristic Share (issue #9045) fixes the VERDICT by blending the one-ply
reading into the root score; it does not touch the rollouts, so the residue
stands and any future rollout-policy change will meet it again.

**Three hypotheses, none measured.**

1. ε-move dilution: with `rolloutEpsilon` 0.25 one move in four is uniform
   random, and a larger hand means more random CASTS that develop rather
   than attack, so the far-ahead opponent spends its rollout turns deploying.
2. Mana tapped out in the first main phase: a greedy one-ply policy with a
   full hand casts in the precombat main (each cast reads as an immediate
   material gain), tapping out before combat and before the Bot's turn, so
   the extra cards buy board, not damage, inside a short horizon.
3. One-ply myopia of `policyValue`: a one-resolution lookahead values a
   creature in hand at the latent discount and on the battlefield at full,
   so "cast another creature" out-scores "attack with what I have" whenever
   the attack is not immediately lethal — and an opponent far ahead is
   rarely one attack from lethal at the horizon.

A fourth reading is that the measurement is right and the position is
genuinely a loss either way: the Bot is ~850–1 850 points behind at every
horizon leaf, so the gift costs nothing the rollouts can see — but the
one-ply gap says otherwise, and the gap growing with budget says the search
is converging on the gift, not dithering.

**Why it may not deserve its own issue.** It is a rollout-policy question
with one known position; the fix the Brain shipped (λ) makes the position
right by construction, and PRD #9043's second slice (the beneficial-slot
guard) covers the class from the other side. It deserves a ticket only if a
second position shows the rollouts preferring a gift the one-ply reading
rejects — the λ-vs-rollout disagreement is now visible per candidate in the
Decision Trace (`h` against `r`), so the next one will be cheap to spot.
