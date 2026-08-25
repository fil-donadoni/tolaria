# Reward calibration — margin → win probability, fitted and rejected (issue #1929, map #1892 step 3)

**Question.** The open reward band of `rewardFromValue` (`convex/gre/search.ts`)
maps an `evaluate` margin to a reward by a hand-set linear clip: linear up to
`MATERIAL_FULL = 500`, saturated beyond. The 500 was chosen by eye ("≈ three
creatures ≈ decided"). Replace it with a **margin → win-probability mapping
fitted on self-play outcomes**, so the reward means what it claims to mean, and
so the ~100-point indifference band that #1893 measured shrinks where it
matters.

**Verdict up front: the fit succeeded and the change is REJECTED on the fit's
own evidence.** The calibrated curve is reproducible across two independent
corpora, and it is **flatter** than the guess it would replace — because the
`evaluate` margin barely predicts the winner at all. Swapping it in widens the
indifference band at margin 0 from 100 points to 400 and cuts the mean reward
slope over real positions to 0.33×. Measured directly on the decision corpus,
the share of root picks decided by the search **falls from 16.7% to 5.9%**. The constant lands as code behind the existing variant flag; the
production default is unchanged.

The binding constraint is `evaluate`'s **fidelity**, not the shape of the
mapping downstream of it. A mapping cannot manufacture information the
evaluation does not carry.

## Corpus

Two decision-tier ladder runs, both unblocked by #2747 (before it, the worker
process dropped `marginSamples` silently and every parallel run wrote an
outcome-only corpus):

| run                      | file                                            | games     | margin samples | fitted k        |
| ------------------------ | ----------------------------------------------- | --------- | -------------- | --------------- |
| null, `--orientations 1` | `2026-08-24-10-26-07-s1-decision.jsonl`         | 340       | 7 739          | 9.188e-4        |
| `placebo`                | `2026-08-24-13-31-25-s1-decision-placebo.jsonl` | 680       | 15 569         | 1.039e-3        |
| **pooled**               | —                                               | **1 020** | **23 308**     | **9.983957e-4** |

A sample is one `evaluate` margin from S0's perspective, taken at the first
search-decided node of a game turn, labelled with who went on to win that game.
Two corpora fitted independently agreeing to 12% is the reproducibility check;
the pooled value is what lands in `CALIBRATED_REWARD_K`.

Reproduce: `bun scripts/fit-reward-mapping.ts ladder-runs/<run>.jsonl […]`.

## What the fitted curve says

`P(S0 wins | margin m) = σ(k·m)` with `k = 9.98e-4`:

| claim                                              | fitted curve                     | production linear clip |
| -------------------------------------------------- | -------------------------------- | ---------------------- |
| margin at 75% win probability                      | ~1 100 points (≈ 6 vanilla 2/2s) | 500 = certainty        |
| margin at 90% win probability                      | ~2 200 points                    | 500 = certainty        |
| slope at margin 0 (reward per margin point)        | 1.25e-4                          | 5.0e-4                 |
| indifference band at margin 0 (`OUTCOME_EPS` 0.05) | **400 points**                   | **100 points**         |
| mean slope over the real margin distribution       | 1.18e-4                          | 3.57e-4                |

The last row is the decisive one, and it already accounts for the production
mapping's dead zone: **28.6% of real samples sit beyond `|margin| > 500`**,
where the linear clip's slope is exactly zero and it cannot tell a won position
from an overwhelming one. Even crediting the calibrated curve every point of
that region, it moves the reward **0.33×** as much per margin point as the clip
does, because it is uniformly flat rather than flat-near-zero-and-steep-far.

## Why the curve is flat: the margin barely predicts the winner

Mean log-loss of the fitted mapping on the pooled corpus, against the two
reference points that make it readable:

| predictor                                     | log-loss   |
| --------------------------------------------- | ---------- |
| coin flip (always 0.5)                        | 0.6931     |
| **fitted logistic in the margin**             | **0.6651** |
| production linear clip, read as a probability | 3.7260     |

Two readings, both load-bearing:

- **The fitted curve is barely better than knowing nothing.** 0.665 against
  0.693 is what "this quantity carries very little outcome information" looks
  like.
- **The production mapping is not merely uncalibrated, it is confidently
  wrong.** Read as a probability it scores 3.73 — five times worse than
  guessing — because it declares certainty at ±500 and 28.6% of samples are
  out there, where it is wrong roughly a quarter of the time.

Split by game stage, the margin's information appears only late:

| stage       | fitted k | log-loss |
| ----------- | -------- | -------- |
| turns 1–2   | 3.71e-4  | 0.6914   |
| turns 3–4   | 1.02e-4  | 0.6930   |
| turns 5–6   | 1.64e-4  | 0.6927   |
| turns 7–8   | 2.74e-4  | 0.6917   |
| turns 9–10  | 4.68e-4  | 0.6885   |
| turns 11–13 | 8.87e-4  | 0.6758   |
| turns 14–17 | 1.58e-3  | 0.6330   |
| turns 18–24 | 1.52e-3  | 0.6069   |
| turns 25+   | 1.10e-3  | 0.6272   |

Before turn 8 the margin says **nothing at all** (log-loss within 0.002 of a
coin flip). The slope varies 15× across the table, which is the model-shape
diagnostic the fit script prints — but a stage-aware `k(turn)` buys only
~0.0065 nats over the global constant, because the variation is mostly
"early samples are uninformative" and no slope fixes that. One global constant
is therefore the right model **for a quantity this weak**; a second parameter
would fit noise.

Scope note on this whole section: it tests the margin as a **win-probability
oracle**, which is the harshest question one can ask of it and the one the
reward mapping's design implicitly assumed. It is NOT the question the search
asks, which is local ordering — "of these two sibling positions three plies
apart, which is better". A function can be a poor prophet and a serviceable
local judge. What the numbers refute is building the reward mapping as if the
margin were a probability; they do not, on their own, establish that
`evaluate`'s ordering is bad. Measuring the ordering directly (do sibling
positions rank in the order their games ended?) is the metric #2686 and the
fitted eval of map step 5 should be judged on, and it does not exist yet.

## Mechanism measurement: what the calibrated mapping does to real decisions

Predicted from the arithmetic above, then measured directly rather than
assumed. Two legs of the #1893 decision-telemetry corpus, **identical seeds,
decks, budget and code** — the only difference is which mapping the open reward
band consults:

```
DECISION_CORPUS=1 DECISION_CORPUS_GAMES=2 DECISION_CORPUS_SEED=1929 \
  DECISION_CORPUS_BLADE=0 [DECISION_CORPUS_VARIANT=reward-calibrated] \
  DECISION_CORPUS_OUT=<path>.json \
  bunx vitest run src/lib/ai/selfplay/decisionCorpus.bot.test.ts -t "collects the full corpus"
```

12 self-play games per leg, all 12 decisive by life on both legs (no guard
stops, corpus healthy), 1 162 and 1 139 root decisions:

| what decided the root pick                           | production      | calibrated    |
| ---------------------------------------------------- | --------------- | ------------- |
| **the search (mean reward alone)**                   | **194 (16.7%)** | **67 (5.9%)** |
| material tie-break among outcome-equal contenders    | 628 (54.0%)     | 672 (59.0%)   |
| `self-harm-removal`                                  | 229 (19.7%)     | 281 (24.7%)   |
| `free-development`                                   | 71 (6.1%)       | 65 (5.7%)     |
| `block-quality`                                      | 23 (2.0%)       | 24 (2.1%)     |
| `wasteful-attack`                                    | 9 (0.8%)        | 13 (1.1%)     |
| `announcement-variant`                               | 6 (0.5%)        | 15 (1.3%)     |
| `extra-turn-credit`                                  | 2 (0.2%)        | 2 (0.2%)      |
| decisions with more than one `OUTCOME_EPS` contender | 81.6%           | **93.2%**     |
| decisions decided by a named hand-written rule       | 29.3%           | 35.1%         |

**The search decides 2.9× fewer picks under the calibrated mapping** — 16.7%
down to 5.9% — and 93.2% of decisions arrive at the selection rules as a tie to
be broken, up from 81.6%. The predicted mechanism is exactly what happened: a
flatter reward pushes more sibling moves inside the fixed `OUTCOME_EPS` window,
and the hand-written policy absorbs them.

The production leg's 16.7% is the same quantity #1893 reported as 19.7% on a
different corpus (different seeds, 36 games, and the pre-#1887/#1888/#1890
selection code) — close enough to confirm both measurements, and the reason the
comparison above was run as a matched pair rather than against the published
figure.

Read only `byMechanism` and the two share rows across legs. `gapMarginPoints`
and `gapHistogram` divide the reward gap by the PRODUCTION open-band slope, so a
variant that rescales the reward invalidates that conversion — they are
comparable within a leg, never between legs.

## What the two ladder runs actually measured

Both were launched as step-1 infrastructure and both are easy to misread from
their verdict block alone.

**`--orientations 1` (340 games, reported 45.0% [39.8–50.3]) is a seat-advantage
reading, not a candidate verdict.** With one orientation the candidate label
sits on the same seat in every game, so the number is the first-seat edge: S0
wins 55.0%, identically in both null runs (187/340 and 374/680 — the same games,
since the second orientation of a null pair is a bit-identical replay). Filed as
part of #2779.

**`placebo` (680 games, 51.8% [48.0–55.5]) is the harness noise floor**, the
first one that exists — a null run cannot measure it, since with no variant
installed both seats run the identical config and every pair splits 1–1 by
arithmetic. The mechanism it exposes:

- reseeding the determinizations changed the ply sequence in **328 of 340 pairs
  (96%)**;
- but it flipped the **winner in only 7.1% of games** — the outcome is far more
  stable than the line of play;
- 292 pairs came back 1–1, 48 were discordant (30/18) — consistent with
  neutrality, as a placebo must be.

The pairing structure that makes those numbers legible is thrown away by the
verdict arithmetic (`wilson()` over all games): the paired interval is ±2.00pp
against Wilson's ±3.76pp on this very run. That is #2779.

## Decision

- `CALIBRATED_REWARD_K = 9.983957e-4` lands as code, behind
  `rewardMapping: "calibrated"` — production behaviour unchanged.
- The mapping does **not** become the default, and no decision-tier ladder
  verdict is owed, because no strength claim is made (map #1892: "ladder only
  for strength claims").
- `OUTCOME_EPS` / `VISIT_TOL` are **not** retuned here. Rescaling them to hold
  the tie window at a constant margin width would isolate the mapping's shape
  from its resolution — the only version of this experiment worth a ladder
  verdict — but it is a change to the selection rule, which #1929 explicitly
  defers.
- Refit is a step inside whatever ticket next changes `evaluate`'s features
  (#2686, then the fitted eval of step 5), not a periodic chore: the fit costs
  seconds, the corpus is reusable, and the constant only moves when the
  quantity it maps changes.
