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

## Instrumentation

`selectRootMove` now emits one `RootDecisionRecord` per decision through an
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

1. **Blade registry** — every scenario in
   `convex/gre/ai/blade/registry.ts`, run through the production
   `runBladeScenario` (its own fixed decks/seeds/budgets).
2. **Self-play** — bot-vs-bot games over six preset-deck pairings spanning
   archetypes (aggro, control, midrange, artifacts; mirrors included), via
   the production `runHeadlessGame`, at the production iteration budget
   (`iterations: 400`; the live `DEFAULT_BUDGET` adds `timeMs: 1500`, which
   is non-deterministic and therefore excluded — the corpus search is a
   mild upper bound on live search effort). On-the-play seat alternates per
   game.

Reproduce with (per shard, ~90 min each; shard seeds below):

```
DECISION_CORPUS=1 DECISION_CORPUS_GAMES=2 DECISION_CORPUS_SEED=<seed> \
  [DECISION_CORPUS_BLADE=0] \
  bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts -t "runner"
```

| Shard | Seed | Games | Blade         |
| ----- | ---- | ----- | ------------- |
| A     | 1893 | 12    | all scenarios |
| B     | 2893 | 12    | excluded      |
| C     | 3893 | 12    | excluded      |

Corpus scale note: at ~7–8 min per game (single-threaded, 400 iterations),
the ticket's "a few hundred games" would cost ~40 CPU-hours; 36 games ≈
TODO_DECISION_COUNT root decisions is already decision-grade for the shares
and histogram reported here, and the sharded runner makes a larger corpus a
matter of more shards, not new tooling.

## Results

TODO — mechanism shares, gap histogram with the 100-point band marked,
per-phase and per-move-kind breakdowns, per-rule fire counts, corpus health.

## Verdict on map #1892 evidence 1

TODO — confirmed or refuted, with the numbers.
