# The one-ply Evaluation holds a fixed share of the root verdict: the Root Heuristic Share λ = 0.1, chosen by a measured grid

## Status

accepted (2026-11-09, issue #9045, PRD #9043). Extends ADR 0176 (the reward
tail is a measured variant; the misdirected Ancestral Recall of issue #8954
is carried by the rollouts) with the root fix it left open, and amends the
root-selection design of ADR 0018 / ADR 0124 §5: the verdict every root rule
reads is no longer the mean rollout reward alone. Evidence:
`convex/gre/__tests__/search.bot.test.ts` (the blend and its floor on a
hand-built root), `convex/gre/ai/__tests__/rootHeuristicShare.bot.test.ts`
(the blend through the real search on the issue #8954 registry entry),
`convex/gre/__tests__/decisionTrace.bot.test.ts` (the two trace numbers), and
the measurements below (base `8e1a3a78b`, seed 1).

## Context

The Brain's root verdict (`selectRootMove`, `convex/gre/search.ts`) was read
from the mean reward of the rollouts: the outcome band, the material
tie-break and every hold rule compared `totalReward / visits`. The one-ply
Evaluation of each candidate — `policyValue` of the position right after the
move, the same reading the PUCT priors are built from and memoized on the
root (`Node.policyValues`) — entered the verdict only at a STARVED root
(fewer than two iterations per candidate), as eight virtual rollouts, and
faded as real visits arrived.

In the issue #8954 position (report `nd77dmd2w9xnh5rg0d23r7gvj58hvyfv`, the
cast of the prepared Ancestral Recall copy undone, priority to the Bot) the
evaluator was right and had no voice: on the reward scale the one-ply reading
of "I draw three" is 0.600 and of "they draw three" 0.288, while the rollouts
rank the gift FIRST (0.2369 against 0.2239 at 600 iterations, 0.2288 against
0.2257 at 3 000). ADR 0176 measured why the rollouts are wrong there and set
the reward tail aside; this record gives the evaluator a permanent share.

## Decision

- **One score per root candidate.** `makeRootScorer` (`search.ts`) returns
  `mean(e) = (1 − s) · mean rollout reward + s · one-ply reward`, where the
  one-ply reward is the root's memoized `policyValue` for the edge's key
  through `rewardFromValue` (bot perspective, as every root edge is the Bot's
  own move) and `s` is the share. `selectRootMove` reads it everywhere the
  raw mean was read — contenders, material tie-break, hold rules, the
  decision-telemetry record (`bestMean`, `chosenMean`) — so no rule is added
  or re-gated; `rootDecisionSettled` (the early stop) reads the same score,
  so a decision counts as settled when the number the verdict is read from
  has a decisive lead; `buildTrace` writes it per candidate.
- **The share.** `s = rootHeuristicShare` (λ), a constant of the base,
  non-fitted vector (`FIT_BASE_EVAL_WEIGHTS`, `convex/gre/ai/evalWeights.ts`).
  At a starved root `s = max(λ, 8 / (visits + 8))` — the pre-#9045 prior,
  kept in its historical arithmetic, is λ's FLOOR: the one-ply reading never
  weighs less than today's eight virtual rollouts. A candidate with no
  memoized one-ply value (a root opened under `actionPriors: null` with
  budget to spare) blends with its own mean — no penalty. Root only: the
  in-tree PUCT priors are untouched. **λ = 0 reproduces the pre-#9045 picks
  byte for byte** (`search.bot.test.ts`; the `root-heuristic-share-0` ladder
  variant is the control arm).
- **λ = 0.1**, the smallest grid value that (a) ranks the self-cast above the
  misdirected cast on the reconstructed prod position at 600 AND 3 000
  iterations and (b) leaves the whole `must` tier green. The grid stays in
  `LADDER_VARIANTS` as the record (`root-heuristic-share-{0,0.1,0.15,0.2,0.3}`).
- **The Decision Trace** gains `oneplyReward` and `score` per candidate (no
  new `EvalTerms` key): `h` and `s` beside `r` in the trace line and the
  legend. The verdict is read from `s`; `r` alone no longer ranks.

## What was measured

All numbers: seed 1; the reconstructed prod position as in ADR 0176; the
four root candidates — the misdirected cast ("→ opponent"), the self-cast
("→ Bot"), `pass` (the hold `last-window-deferral` picks: an instant kept for
the opponent's turn, accepted by the registry entry), the Brazen Borrower
cast. The tree is the same at every λ (the share changes the verdict, not
the walk), so the rollout means repeat; what moves is the score.

| λ    | iterations | misdirected score (mean) | self-cast score (mean) | self − misdirected | verdict (score order)                  |
| ---- | ---------- | ------------------------ | ---------------------- | ------------------ | -------------------------------------- |
| 0    | 600        | 0.2369 (0.2369)          | 0.2239 (0.2239)        | −0.0130            | misdirected FIRST, self last           |
| 0    | 3 000      | 0.2288 (0.2288)          | 0.2257 (0.2257)        | −0.0031            | misdirected FIRST                      |
| 0.1  | 600        | 0.2421                   | 0.2615                 | +0.0194            | pass, Borrower, self, misdirected LAST |
| 0.1  | 3 000      | 0.2347                   | 0.2631                 | +0.0284            | Borrower, self, pass, misdirected LAST |
| 0.15 | 600        | 0.2446                   | 0.2803                 | +0.0357            | misdirected last                       |
| 0.15 | 3 000      | 0.2377                   | 0.2818                 | +0.0441            | misdirected last                       |
| 0.2  | 600        | 0.2472                   | 0.2992                 | +0.0520            | misdirected last                       |
| 0.2  | 3 000      | 0.2407                   | 0.3005                 | +0.0598            | misdirected last                       |
| 0.3  | 600        | 0.2523                   | 0.3368                 | +0.0845            | misdirected last                       |
| 0.3  | 3 000      | 0.2466                   | 0.3380                 | +0.0914            | misdirected last                       |

One-ply rewards at the root (every λ): misdirected 0.2882, pass 0.5821,
self-cast 0.6000, Borrower 0.6246. At every λ ≥ 0.1 the self-cast is above
the misdirected cast by more than `outcomeEps` (0.05) from 3 000 iterations
on, and by 0.019 at 600 iterations under 0.1 — inside the band, where the
material tie-break (the self-draw leaves more cards) ranks it the same way.

**The `must` tier.** Pre-check on the 31 entries ADR 0176 named as marginal
plus the held-trick and issue #8954 entries, every seed:

| λ    | pre-check (31 entries) | red entry                                                                                                |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 0    | 0 red                  | —                                                                                                        |
| 0.1  | 0 red                  | — (full tier: 508 entries, 0 red, 684 s on six shards)                                                   |
| 0.15 | 1 red                  | "poison clock: Terror takes the infect Grizzly Bears over the bigger Hill Giant at seven poison", seed 1 |
| 0.2  | 1 red                  | the same entry, seed 1                                                                                   |
| 0.3  | 1 red                  | the same entry, ALL five seeds                                                                           |

The upper bound is not where the issue expected it. The held-trick entries
(Counterspell held through the opponent's turn, Tamiyo's Safekeeping held
through a surveil trigger) stay green at every λ up to 0.3: their verdicts
are `mean-reward` / `last-window-deferral` with a lead the blend does not
erase. The entry that breaks is a HORIZON one: at seven poison the infect
Grizzly Bears is lethal in two swings, which only the rollouts see; the
one-ply Evaluation prefers removing the bigger Hill Giant, and from λ = 0.15
its share tips one seed, at 0.3 every seed. The same shape ADR 0176 found for
the PUCT prior `c`: every blade entry the one-ply reading breaks is one
authored precisely because greedy one-ply gets it wrong, so the share must
stay small.

**Held-out pick agreement** (`bun run verdicts:pick-agreement`, n = 24):
@@PA_TABLE@@

**The Toxic Deluge entry** ("life X: Toxic Deluge never pays to lethal"),
the case ADR 0176 raised for an outcome-aware material tie-break: green under
λ = 0.1 on all five seeds, verdict `material-tiebreak` on each — the blend
did not change which rule decides it, and the tie-break still ranks the
certain loss by surviving material. Recorded as a finding
(`docs/findings/9045-outcome-aware-material-tiebreak.md`).

## Consequences

- Issue #8954's root symptom is fixed by construction wherever the one-ply
  Evaluation is not itself clipped: the misdirected cast is last at every
  λ ≥ 0.1. Where the ROOT is already past ±`materialFull` (the hand-cast
  registry entry, ≈ −815) the one-ply reward is the band floor like the
  rollouts, the share blends nothing and the material tie-break keeps the
  pick (`rootHeuristicShare.bot.test.ts` pins both readings — under the clip,
  and under `reward-soft-tail`, where the blend ranks the self-draw first).
  The clip's blindness at the root is ADR 0176's open question, not this
  record's.
- The rollout residue stands (`docs/findings/9045-rollout-residue-gifted-draw.md`):
  λ does not touch the rollouts, and `h` against `r` in the trace now shows
  per candidate where they disagree.
- `bot:refit --check` lags on the search-cost pins and the pin snapshots the
  blended early stop and the changed contender sets move
  (`searchCost.bot.test.ts`, the `bot-pins` snapshots); the base regenerates
  them (`derive:sync`, ADR 0157 Amendment II) — the PR carries none.
- A later claim about λ is an A/B against `root-heuristic-share-0`
  (today's picks) on the ladder, judged against `placebo`, and owes the
  `must` tier green plus its held-out delta (PRD #3980).
- `PendingChoice` roots and opponent option views are unchanged: the share
  reads the Bot's own root edges only.
