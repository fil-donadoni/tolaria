# What reading the generated vector costs at a leaf (issue #10862, ADR 0186)

> **Measured at** `a201088af` (2026-11-27), branch `feat/issue-10862` on the
> base tip `032aa0300`, on the MacBook runner (Apple M1 Pro, 8 cores, 16 GB)
> while it ran other jobs: load average 16–22 throughout. Node 24.21.0 (V8).
> Slice of PRD issue #10849. Re-run before quoting a number.

**Question.** Issue #10862 makes the Evaluation read the generated vector as a
correction priced by a weight table, behind the `generated-vector` search
variant. The committed table is empty, so under the variant the correction is
computed and worth zero: every pick is the base's and the only difference is
time. How much time, per iteration of the search? And does the answer call for
an incremental update of the vector, or is a full recompute at every
evaluation affordable?

**Verdict up front.**

1. **A full recompute is affordable, if it builds no vector.** The Evaluation
   walks the position once and multiplies each count by its weight as it
   meets it (`pricedGeneratedVector`). On seven late-game boards the search
   costs between −0.6% and +1.2% per iteration under the variant, median
   +0.4%: not distinguishable from zero on a bench whose single rounds swing
   by ±15%. One evaluation alone costs +1% to +17%, median +6%.
2. **Building the vector first costs measurably more.** The first
   implementation built the sparse vector (a map of counts, sorted into
   column order) and then took its dot product with the table. Same boards:
   +2.6% to +6.4% per iteration on six of seven, median +4.7%; one evaluation
   +7% to +17%, median +13%.
3. **No incremental update.** It would carry the vector from a position to
   the next across every move the search applies, which is a second
   bookkeeping of the whole board. The measured cost of the walk does not pay
   for that.
4. **Two things this does not measure.** The boards are not the field boards
   of `rollout-policy-cost.md`: those are production games kept out of the
   repository, and they were not on the machine that ran this (§ Not
   measured). And the `need` family reads zero at a leaf, because the
   Evaluation is handed no Deck Knowledge
   (`docs/findings/10862-need-family-reads-zero-at-every-leaf.md`): what its
   derivation would cost per leaf is not in any number here.

## Method

The bench of `rollout-policy-cost.md`: one esbuild bundle of the real search
(`bundle.mjs`), run in Node on the process CPU clock. Its `speed` method is
kept: each board is searched under `base` and under the variant at a fixed
iteration count, in interleaved rounds whose order alternates, one warm-up
round discarded. The ratio of a board is the median of its per-round ratios.

- **The arms.** `base`: no variant, the committed weights, no table.
  `generated-vector`: the variant of `LADDER_VARIANTS`, which hands the
  Evaluation the committed table (`generatedVector/committedWeights.ts`).
- **The boards.** A field fixture when one is given (`--field`). Otherwise a
  late-game board of a self-played game (`entry-generated.mjs`): two Preset
  Decks played headless by the search at 12 iterations a decision, and the
  widest board the game reaches at the start of a precombat main phase from
  turn 10 on, with the active player to decide, an empty stack and at least
  three legal moves. Rebuilt from a seed on any machine, and kept as a
  fixture (the engine's own compacted row), so a self-played board and a
  field board are searched by the same `runField`, both decks known.
- **Two readings per board.** The whole search, 60 iterations a round, five
  rounds: CPU milliseconds per completed iteration. And the Evaluation alone,
  3,000 calls of `evaluateWithMargin` a round on the board itself: CPU
  microseconds per call, with no rollout around it.
- **Both arms pick the same move and return the same value** on every board
  in every round (`sameMove`, `sameEvaluation` in the output). The guard that
  the committed table changes no Evaluation is
  `generatedVector/__tests__/generatedCorrection.bot.test.ts`.

## Results

`ms/it`: CPU milliseconds per completed iteration. `µs/eval`: CPU microseconds
per evaluation. `ratio`: variant over base, median of five paired rounds.
Board labels are `<deck> v <deck> seed <n>`, at the turn captured.

### The streaming walk (what the branch ships)

| board                               | turn | permanents | base ms/it | variant ms/it | ratio | base µs/eval | variant µs/eval | ratio |
| ----------------------------------- | ---- | ---------- | ---------- | ------------- | ----- | ------------ | --------------- | ----- |
| mono-green-stompy v white-weenie, 7 | 18   | 19         | 2.96       | 2.97          | 0.994 | 130.9        | 139.1           | 1.063 |
| uw-control v mono-black, 3          | 49   | 30         | 7.06       | 7.25          | 1.006 | 482.3        | 493.8           | 1.022 |
| erhnamgeddon v robots, 5            | 12   | 14         | 33.16      | 33.83         | 0.996 | 143.5        | 142.2           | 1.033 |
| bg-sacrifice v rg-kicker, 11        | 16   | 20         | 4.33       | 4.56          | 1.007 | 192.7        | 196.9           | 1.008 |
| le-deck v mono-r-aggro, 2           | 11   | 10         | 12.63      | 12.58         | 0.994 | 93.8         | 97.7            | 1.076 |
| mono-u-tempo v gueddon, 4           | 18   | 20         | 20.96      | 21.04         | 1.004 | 222.5        | 260.1           | 1.169 |
| channel-fireball v mono-black, 8    | 18   | 21         | 22.36      | 22.61         | 1.012 | 449.5        | 479.0           | 1.059 |

Per iteration: median 1.004, range 0.994–1.012. Per evaluation: median 1.059,
range 1.008–1.169. The per-round ratios behind each iteration figure span
0.84 to 1.17, so a board's median of five is good to a few percent, no
better. The `ms/it` and `µs/eval` columns are each arm's own median over the
rounds, so their quotient is not the `ratio` column.

A second run of the same boards an hour later, under heavier load (22–28) and
with every base figure about half again as slow, read per-iteration ratios of
0.84 to 1.07 across the seven boards, median 0.97, and per-evaluation ratios
of 0.93 to 1.08, median 1.01. The effect is smaller than what the machine's
other work does to a run.

### Building the vector, then the dot product (the first implementation)

The same commit with `generatedCorrection` calling `generatedVector` and
summing over the sparse vector, bundled apart and run on the same boards.

| board                               | base ms/it | variant ms/it | ratio | base µs/eval | variant µs/eval | ratio |
| ----------------------------------- | ---------- | ------------- | ----- | ------------ | --------------- | ----- |
| mono-green-stompy v white-weenie, 7 | 2.83       | 2.97          | 1.055 | 118.8        | 132.1           | 1.112 |
| uw-control v mono-black, 3          | 6.69       | 6.84          | 1.026 | 451.3        | 474.3           | 1.081 |
| erhnamgeddon v robots, 5            | 27.59      | 28.90         | 1.053 | 111.0        | 127.8           | 1.139 |
| bg-sacrifice v rg-kicker, 11        | 3.27       | 3.38          | 1.064 | 136.9        | 155.9           | 1.126 |
| le-deck v mono-r-aggro, 2           | 9.06       | 9.18          | 0.968 | 67.2         | 78.0            | 1.175 |
| mono-u-tempo v gueddon, 4           | 12.53      | 12.97         | 1.047 | 140.4        | 158.4           | 1.126 |
| channel-fireball v mono-black, 8    | 13.71      | 14.23         | 1.039 | 272.6        | 290.4           | 1.073 |

Per iteration: median 1.047. Per evaluation: median 1.126. The two tables
were run minutes apart under different load, so their absolute columns do not
compare; the ratios are paired inside each run.

### Where the time went (one CPU profile)

One board (`mono-green-stompy v white-weenie`, seed 7), four searches of 40
iterations under the vector-building implementation, V8 sampling profiler at
200 µs: `generatedCorrection` held 6.2% of the samples (a fifth of all
samples were the profiler's own idle frame), 5.8% of them in
`generatedVector` — 4.7% in the per-player walk with its map writes, 0.8% in
sorting the vector into column order. The walk reads the mana census the
Evaluation's own terms read, through the same memo, so the census is not
paid twice.

## What this says

- The objective PRD issue #10849 sets for the Prototype gate is no more than
  10% more milliseconds per iteration. At zero weights the seam uses none of
  it that this bench can see. A fitted table costs the same: the walk
  multiplies by a weight whether or not it is zero.
- The warm-up matters. A first trial of this bench, two measured rounds of
  30 iterations, read +28% to +39% on the first board under the
  vector-building implementation; with five rounds of 60 the same board and
  implementation read +5.5%. The walk's code is cold for the first searches
  under the variant, and a short run reads that as the cost of the term.

## Not measured

- **The field boards.** `rollout-policy-cost.md`'s four boards are the stored
  rows of production games, pulled by `field-position.mjs` and kept out of
  the repository. They were not on the runner, and pulling production rows is
  not something an unattended pass does. The command below takes them as
  they are (`--field`). The self-played boards cover the same range of cost
  per iteration (3 to 34 ms, against a 20.75 ms field target) but are not the
  boards the field Bot was slow on.
- **Browsers.** Node only. The field Bot runs in Chromium, WebKit and Gecko.
- **The `need` family.** Zero at every leaf today (see the finding); its
  derivation walks the seat's list and is the one part of the vector whose
  cost per leaf is unknown.

## Reproduce

```bash
B=docs/research/scripts/brain-bench
node $B/run-generated.mjs build /tmp/generated.js
node $B/run-generated.mjs speed /tmp/generated.js /tmp/generated-speed.json \
     --selfplay mono-green-stompy:white-weenie:7 --selfplay uw-control:mono-black:3 \
     --selfplay erhnamgeddon:robots:5 --selfplay bg-sacrifice:rg-kicker:11 \
     --selfplay le-deck:mono-r-aggro:2 --selfplay mono-u-tempo:gueddon:4 \
     --selfplay channel-fireball:mono-black:8 \
     --iterations 60 --rounds 5 --play-iterations 12 --evaluations 3000
# the field boards, where their fixtures are:
node $B/run-generated.mjs speed /tmp/generated.js /tmp/generated-field.json \
     --field field-jh7396nx.json [--field <fixture.json>]... \
     --iterations 60 --rounds 5
```
