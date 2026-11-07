# Decision telemetry — what decides a root pick? (issue #1893, map #1892)

> **Measured at** the pre-#1887 selection code, **2026-07-29**, 36 self-play
> games + 11 blade scenarios, 400 iterations. **Dated:** `selectRootMove` has
> since grown from 8 to 15 `ROOT_DECISION_MECHANISMS` (frozen, ADR 0124 §5),
> the blade registry from 11 scenarios to several hundred, and the weights
> are now fitted from Verdicts (ADR 0124). The map these numbers served was
> re-chartered as Roadmap v3 (ADR 0138). § Re-measure below holds the
> 2026-11-07 numbers, and § With action priors the effect of issue #8700.

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

## Re-measure — 2026-11-07, self-play only

**Measured at `3f750884247a` (2026-11-07)**, the production search as live
play runs it that day: `DEFAULT_EVAL_WEIGHTS` fitted from the Verdict Lock,
15 `ROOT_DECISION_MECHANISMS`, action priors OFF (issue #2684's PUCT branch is
`null` without a `SearchVariant`), opponent blind (no deck knowledge, as every
preset below `expert`). Same runner, same six preset pairings, one game per
pairing instead of two per shard, seed 1893, 400 iterations, no blade half:

```
DECISION_CORPUS=1 DECISION_CORPUS_GAMES=1 DECISION_CORPUS_SEED=1893 \
  DECISION_CORPUS_BLADE=0 DECISION_CORPUS_OUT=<path>.json \
  bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts -t "collects the full corpus"
```

6 games, all decisive by life, **432 root decisions** (one shard; the July
corpus had 2833 over 36 games — treat a point or two of difference as noise,
not a trend). Wall clock 64 min on a machine at load average ~90.

### Which mechanism decides the pick

| mechanism            | 2026-07-29 (n = 2833) | 2026-11-07 (n = 432) |
| -------------------- | --------------------- | -------------------- |
| mean-reward          | 19.7%                 | **22.2%** (96)       |
| material-tiebreak    | 66.0%                 | **57.4%** (248)      |
| named rules, total   | 14.3%                 | **20.4%** (88)       |
| free-development     | 5.9%                  | 6.5% (28)            |
| standing-spend-hold  | — (did not exist)     | 6.3% (27)            |
| self-harm-removal    | 6.0%                  | 3.0% (13)            |
| block-quality        | 1.5%                  | 1.9% (8)             |
| wasteful-attack      | 0.9%                  | 1.2% (5)             |
| hold-trick           | 0.0%                  | 0.9% (4)             |
| announcement-variant | —                     | 0.5% (2)             |
| last-window-deferral | —                     | 0.2% (1)             |

Every named rule fired as a flip (it changed the pick the search's argmax
would have made: 88/88); the material tie-break flipped 35 of its 248.
Overall **28.5% of picks differ from the strict mean-reward argmax**;
75.5% of decisions had more than one `OUTCOME_EPS` contender (July: 79.4%);
74.8% of final picks coincide with the argmax (July: 74.9%).

### Best-vs-second reward gap (margin points; band edge = 100)

| gap (points) | n   | share |
| ------------ | --- | ----- |
| ≤5           | 71  | 16.4% |
| ≤10          | 56  | 13.0% |
| ≤25          | 114 | 26.4% |
| ≤50          | 78  | 18.1% |
| ≤100         | 7   | 1.6%  |
| ≤150         | 1   | 0.2%  |
| ≤250         | 1   | 0.2%  |
| single-edge  | 104 | 24.1% |

**326 of the 328 multi-edge decisions (99.4%) sit inside the 100-point band**
(July: 99.5%). The band is as dominant as it was.

### What the 1-ply policy would have picked (new column)

The runner now records whether the greedy one-ply policy (`policyValue`, the
rollout default and the source of the action prior) agrees with the search's
final pick: **59.0% overall**; 77% where the search itself decided
(`mean-reward`, 74/96), 53% where the material tie-break did (131/248), 30%
where `standing-spend-hold` did (8/27). By move kind: land drops 69%
(57/83), casts 58% (70/121), attacks 64% (50/78), blocks 50% (13/26), pass
55% (63/114). This is the quantity issue #8700 (action priors ON) builds
on: a prior that agrees with the search three times in four on the decisions
the search can resolve, and that is weakest exactly where the tie-breaks
rule.

### Reading

- The headline of July stands: roughly four decisions in five are not
  separated by the search's reward signal. The split inside that four moved —
  less material tie-break (66% → 57%), more named rules (14% → 20%) — which is
  the five rules added since (`standing-spend-hold` alone takes 6%) doing
  what they were written to do, not the search deciding more.
- `mean-reward` 19.7% → 22.2% is within what a 432-decision sample can tell;
  the fitted weights did not widen the reward gaps in a visible way (p50 of
  the gap is still inside ≤25).
- The structural reading of map issue #1892 is therefore unchanged by this
  re-measure: the band, not the depth, decides. The levers the owner chose on
  2026-11-07 (issue #8700 priors ON, issue #8701 policy features, knowledge at
  every level per issue #8692) all act on how visits are spent inside the
  band; this table is their baseline. Re-run the command above on their tip
  and add the column.

## With action priors — 2026-11-07, issue #8700

**Measured on the issue #8700 branch over base `d3cac821f` (2026-11-07)**, both
arms on that one tree: the command of § Re-measure, the control arm with
`DECISION_CORPUS_VARIANT=no-action-priors`. The control arm reproduces
§ Re-measure's split row for row, so it is the old rule. Live play runs the
other arm since issue #8700 (PUCT, `c = 0.15`, `fpu = 0.15`). One seed and 432
decisions per arm: a point or two is noise.

| measure                                        | flat UCB1   | PUCT            |
| ---------------------------------------------- | ----------- | --------------- |
| mean-reward                                    | 22.2% (96)  | **31.7%** (137) |
| material-tiebreak                              | 57.4% (248) | **47.7%** (206) |
| named rules, total                             | 20.4% (88)  | 20.6% (89)      |
| more than one `OUTCOME_EPS` contender          | 75.5%       | 66.2%           |
| single visit-band edge                         | 24.1% (104) | 33.3% (144)     |
| picks differing from the mean argmax (flipped) | 28.5%       | 26.4%           |
| 1-ply greedy agrees with the pick              | 59.0%       | 60.6%           |
| search wall clock, ms per iteration            | 19.7        | 25.3            |

### Reading

- The search decides more: ten points move from the material tie-break to the
  mean reward, and the named rules do not move. This is the depth the priors
  were turned on to buy.
- The cost is real. An iteration took 28% longer here, on a loaded machine (the
  `policyValue` probes; the `searchCost` pins show clones up 21–26% on 4 and 13
  moves, down on 49), so a `timeMs` cap reaches fewer iterations. Iteration
  budgets (blade, this corpus) do not see it; live `medium` does.
- Held-out pick agreement (`verdicts:pick-agreement`, n = 24, indicative) went
  the other way on the same tree: 14/24 to 13/24, seeds 86/120 to 77/120. The
  verdicts that went from agree to disagree are listed in the PR of issue #8700.
- 400 iterations is not where a tie stops being a tie: issue #8736 is a `must`
  entry that was green at 400 and converges away from its answer at 2000 under
  either rule.
