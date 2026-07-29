# Decision telemetry — what decides a root pick? (issue #1893, map #1892)

**Question.** What share of the bot's real decisions is actually decided by
the search (mean reward), and what share falls to the material tie-break or
to one of the six named tie-break rules in `selectRootMove`
(`convex/gre/search.ts`)?

**Why it matters.** Map #1892's evidence 1 computes an indifference band of
~100 evaluation points: the open-band reward slope of `rewardFromValue` is
`REWARD_PER_MARGIN_POINT = (1 − 2·TERMINAL_BAND) / (2·MATERIAL_FULL)` =
0.0005 reward/point, and `OUTCOME_EPS = 0.05`, so any two moves whose true
values differ by less than ~100 margin points (≈ 12.5 life at `W_LIFE = 8`,
≈ 0.59 of a vanilla 2/2 at Forge scale ≈ 170) are outcome-equal to the
selection. If a large fraction of real decisions lands inside that band, the
bot's policy is substantially hand-written (tie-break rules), not searched.
This document reports the measured fraction.

**Verdict up front: evidence 1 is CONFIRMED, more strongly than the map
states.** Only **19.7%** of real decisions are decided by the search's mean
reward. **66.0%** fall to the material tie-break among outcome-equal
contenders and **14.3%** to a named hand-written rule. The best-vs-second
reward gap has median **13.4 margin points** and p90 **37.8** — among
decisions with at least two visit-band candidates, **99.5% sit inside the
100-point band**. The band is not merely wide relative to typical decisions;
essentially every real decision happens inside it.

## Instrumentation

`selectRootMove` emits one `RootDecisionRecord` per decision through an
**off-by-default** sink (`convex/gre/ai/decisionTelemetry.ts`; nothing is
recorded in live play, and behaviour is unchanged — every exit routes
through a `finish()` helper that returns exactly what each return site
returned before). Per decision it records:

- the best-vs-second mean-reward gap among visit-band edges, in reward
  units and in margin points (`gap / REWARD_PER_MARGIN_POINT`);
- the deciding **mechanism**: `mean-reward` (a single `OUTCOME_EPS`
  contender — the search's argmax stood alone), `material-tiebreak`
  (several outcome-equal contenders, the saturation-proof material margin
  picked), or the named rule that changed the pick (`extra-turn-credit`,
  `wasteful-attack`, `block-quality`, `self-harm-removal`,
  `free-development`, `hold-trick`); a rule that re-selected the same edge
  does not count as deciding;
- contender count (`OUTCOME_EPS` survivors), visit-band survivor count
  (`VISIT_TOL`), visited-edge pool size;
- phase, chosen move kind, whether the root was a choice node, and whether
  the final pick is also the strict mean-reward argmax.

## Corpus

Two deterministic sources, collected by
`src/lib/ai/selfplay/decisionCorpus.ts` (fixed seeds, iterations-only
budgets — never `timeMs`):

1. **Blade registry** — all 11 scenarios in
   `convex/gre/ai/blade/registry.ts`, run through the production
   `runBladeScenario` (its own fixed decks/seeds/budgets). 38 decisions.
2. **Self-play** — 36 bot-vs-bot games over six preset-deck pairings
   spanning archetypes (aggro, control, midrange, artifacts; mirrors
   included), via the production `runHeadlessGame` at `iterations: 400`
   (the live `DEFAULT_BUDGET` adds `timeMs: 1500`, which is
   non-deterministic and therefore excluded — the corpus search is a mild
   upper bound on live search effort). On-the-play seat alternates per
   game. **2833 decisions; all 36 games decisive by life** (zero guard
   stops — corpus fully healthy).

Reproduce with (one shard ≈ 50–120 min wall-clock depending on machine
contention):

```
DECISION_CORPUS=1 DECISION_CORPUS_GAMES=2 DECISION_CORPUS_SEED=<seed> \
  [DECISION_CORPUS_BLADE=0] DECISION_CORPUS_OUT=<path>.json \
  bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts -t "collects the full corpus"
```

| Shard | Seed | Games | Blade         | Decisions |
| ----- | ---- | ----- | ------------- | --------- |
| A     | 1893 | 12    | all scenarios | 1100 + 38 |
| B     | 2893 | 12    | excluded      | 809       |
| C     | 3893 | 12    | excluded      | 924       |

**Code-drift note.** The corpus was measured on the pre-#1887/#1888/#1890
selection code (the six original tie-breaks, including the #365
friendly-vs-enemy redirect). While this ticket was in flight, main landed
dominance pruning (#1887), the announcement-variant tie-break (#1888,
subsuming the #365 redirect — instrumented as `announcement-variant`), and
activation-timing rules (#1890, folded into the hold-trick branch). Those
changes move work _between_ mechanisms (e.g. some `self-harm-removal` fires
become `announcement-variant` fires) but do not touch the reward slope,
`OUTCOME_EPS`, or the material tie-break, so the headline split —
search-decided vs band-decided — is unaffected. Re-running the corpus on
current main is one command per shard (below).

Corpus scale note: at ~4–8 min per game (single-threaded, 400 iterations),
the ticket's "a few hundred games" would cost tens of CPU-hours; 36 games =
2871 root decisions is decision-grade for the shares and histogram reported
here, and the sharded runner makes a larger corpus a matter of more shards,
not new tooling.

## Results (combined corpus, 2871 decisions)

### Which mechanism decides the pick

| mechanism         | n    | share     |
| ----------------- | ---- | --------- |
| mean-reward       | 565  | **19.7%** |
| material-tiebreak | 1896 | **66.0%** |
| self-harm-removal | 171  | 6.0%      |
| free-development  | 168  | 5.9%      |
| block-quality     | 44   | 1.5%      |
| wasteful-attack   | 26   | 0.9%      |
| extra-turn-credit | 1    | 0.0%      |
| hold-trick        | 0    | 0.0%      |

79.4% of decisions have more than one `OUTCOME_EPS` contender (the search
did not resolve them); 74.9% of final picks coincide with the strict
mean-reward argmax — i.e. when a tie-break overrides, it overrides for real
in about a quarter of all decisions.

### Best-vs-second reward gap (margin points; band edge = 100)

| gap         | n   | share |
| ----------- | --- | ----- |
| ≤5          | 567 | 19.7% |
| ≤10         | 365 | 12.7% |
| ≤25         | 776 | 27.0% |
| ≤50         | 489 | 17.0% |
| ≤100        | 84  | 2.9%  |
| ≤150        | 10  | 0.3%  |
| ≤250        | 1   | 0.0%  |
| single-edge | 579 | 20.2% |

Percentiles (multi-edge decisions): p25 = 5.1, p50 = 13.4, p75 = 25.3,
p90 = 37.8. **99.5% of multi-edge decisions have a gap ≤ 100 points.** The
practical spread of the reward signal between the top two moves is an order
of magnitude _smaller_ than the indifference band — `OUTCOME_EPS = 0.05`
(100 points) is calibrated for a signal the reward function never actually
produces at this budget.

### By phase (share decided by mean-reward / material / named rule)

| phase               | n    | mean-reward | material | named |
| ------------------- | ---- | ----------- | -------- | ----- |
| PRECOMBAT_MAIN      | 1334 | 15.1%       | 71.0%    | 13.9% |
| DECLARE_ATTACKERS   | 614  | 34.2%       | 58.6%    | 7.2%  |
| POSTCOMBAT_MAIN     | 199  | 22.6%       | 66.3%    | 11.1% |
| DRAW                | 164  | 19.5%       | 64.0%    | 16.5% |
| UPKEEP              | 156  | 14.7%       | 67.3%    | 17.9% |
| DECLARE_BLOCKERS    | 151  | 25.8%       | 42.4%    | 31.8% |
| BEGINNING_OF_COMBAT | 94   | 8.5%        | 78.7%    | 12.8% |
| END_STEP            | 78   | 6.4%        | 75.6%    | 17.9% |
| COMBAT_DAMAGE       | 42   | 2.4%        | 64.3%    | 33.3% |
| END_OF_COMBAT       | 39   | 0.0%        | 59.0%    | 41.0% |

### By chosen move kind

| move kind         | n   | mean-reward | material  | named |
| ----------------- | --- | ----------- | --------- | ----- |
| cast-spell        | 734 | 24.1%       | 71.3%     | 4.6%  |
| pass              | 585 | 19.0%       | 53.5%     | 27.5% |
| declare-attackers | 524 | 38.7%       | 56.3%     | 5.0%  |
| play-land         | 491 | 5.7%        | 64.8%     | 29.5% |
| activate-ability  | 398 | 0.5%        | **99.5%** | 0.0%  |
| declare-blockers  | 126 | 30.2%       | 34.9%     | 34.9% |

Notable: **ability activations are essentially never decided by the
search** — 99.5% fall to the material tie-break. Block declarations are the
most hand-written decision class (34.9% named rules, mostly
`block-quality`). Land drops are decided by `free-development` 29.5% of the
time — the rule, not the search, is what develops the board.

### Which of the six tie-breaks actually fire

- **Load-bearing**: `self-harm-removal` (171) and `free-development` (168)
  together decide ~12% of all decisions — they are policy, not edge-case
  patches.
- **Occasionally decisive**: `block-quality` (44 — but 34.9% of all block
  picks), `wasteful-attack` (26).
- **Dead weight on this corpus**: `hold-trick` fired **zero** times,
  `extra-turn-credit` once (the preset pool holds almost no extra-turn
  cards; the rule is corpus-starved rather than wrong). Per the ticket
  scope this is reported, not acted on.

### Blade corpus (38 decisions, for contrast)

Blade positions are authored to have a discoverable right answer:
mean-reward decides 52.6% there (vs 19.2% in self-play), and 52.6% are
single-edge (forced-ish). The gap between the two corpora is itself
evidence: real games live inside the indifference band far more than
authored puzzles do.

## Verdict on map #1892 evidence 1

**Confirmed.** The claimed mechanism — a ~100-margin-point indifference band
inside which the search cannot decide — is real and dominant:

- four of five real decisions (80.3%) are NOT decided by the search's
  reward signal (66.0% material tie-break + 14.3% named rules);
- the reward signal's own best-vs-second spread (p50 13.4, p90 37.8
  points) is an order of magnitude below the band edge, so `OUTCOME_EPS`
  swallows nearly every real distinction the search finds;
- the named rules are load-bearing policy exactly as the map claims —
  two of six decide ~12% of everything, and blocks/land-drops are decided
  by hand-written rules about a third of the time.

Implication for the map's priority order (consistent with the research
findings in `mcts-small-budget-strength.md`): reward-scaling work
(calibrated margin → win-probability, steeper slope at even positions)
attacks the measured bottleneck directly, and anything that sharpens the
reward signal (truncation with static eval, priors/FPU) compounds it. The
material tie-break deciding 66% of picks also means the _evaluation's_
fidelity — not the search's depth — is the binding constraint, exactly the
map's thesis.
