# Rollout policy cost: what a cheaper greedy pick buys and loses (issue #10134)

> **Dated:** 2026-11-19, at `0c7a640a2` (base tip), on the Huawei runner
> (Intel i7-8550U, 4 cores / 8 threads, 16 GB) while it also ran other
> pipeline work: load average 4–11 throughout. Node 24.21.0 (V8 13.6),
> Playwright 1.62.1 (Chromium 151.0.7922.34, Firefox 153.0). **Every number
> below is as of that commit and that day.** Slice of PRD issue #10017; the
> owner's ruling is § 6.

**Question.** The owner ruled (issue #10027, `expert-think-longer.md` § 5)
that `expert` must reach 400 iterations per search on every engine family:
400 in 5 s is 12.5 ms per iteration, a 3.7× speed-up for Gecko against its
pooled field rate of 46 ms (`expert-think-longer.md` § 5, ruling 2), whose
field searches complete 71 iterations today (`blade-at-field-budgets.md`).
Per-iteration engine work
so far moved about 2% each (PR #10103, PR #10100). Every rollout plays to the
start of the Bot's next turn (ADR 0015), and at every ply with more than one
candidate the greedy default policy (`selectRolloutMove`, ADR 0021) clones the
state, applies, settles and evaluates **every** candidate before playing one.
How much of an iteration is that policy, and what does a cheaper one buy in
time and lose in decisions?

**Verdict up front.**

1. **On blade boards the policy is not where the time goes; on field boards it
   is.** A blade `must` search spends 10–23% in the policy's probes and 39–59%
   in the tree's own descent (§ 1). Two late-game production boards spend
   **67–73%** in the probes and 10–12% in the descent: 9–12 probing plies per
   rollout with 7–8 candidates each (60–96 probes per rollout), against about
   3 per rollout on a blade board. The issue's multiplier holds where the
   field Bot is slow, and nowhere else.
2. **No policy that still probes buys the order of magnitude.** Free probes
   (`prefix:0`, a uniform-random rollout after the first greedy ply) are the
   ceiling: 2.8–4.0× faster per iteration on a field board, in V8. The
   cheapest probing candidate, `topk:2`, is 1.4–2.1×; a shorter rollout
   (`cap:16`) cuts 60% of the plies and only 9–14% of the time, because the
   probes sit in the turn the rollout starts in (§ 2).
3. **Quality:** ⟨TBD § 3⟩
4. **A memo of the probes is dead on arrival** (§ 4): an exact ply key
   recurs 0.3% of the time within one search; a key blind to the libraries
   11.5% on blade boards and **0%** on the field boards where it would pay.
5. **Recommendation:** ⟨TBD § 5⟩ The owner's ruling is pending (§ 6).

## Method

The bench of `brain-search-off-the-dev-machine.md` (one esbuild bundle of the
real search, every engine runs the same bytes), with a rollout seam patched
in AT BUNDLE TIME only (`bundle.mjs`, `rolloutHook`; the source tree's
`search.ts` is untouched, so nothing here changes a default):

- `rollout` and `selectRolloutMove` become wrappers that hand their call to
  an installed hook; the ply loop reads a hook's ply cap before
  `MAX_ROLLOUT_PLIES`; every rollout ply reports itself (a forced pass, or a
  played move and its candidate count). Each patch must match once or the
  build throws; with no hook installed the bundle picks the same moves as the
  unpatched one (checked on three positions).
- **The candidate policies** (`rollout-policies.mjs`), each installed for a
  whole search and active only inside a rollout (the root's own reads of the
  greedy pick are left alone):

| policy     | what the greedy ply does                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`     | today: probe every candidate, play the best                                                                                                                                            |
| `topk:K`   | rank the candidates by a static per-move-kind score (land > cast > activation / attack / block > other > empty declaration > pass) and probe only the best K, `pass` always among them |
| `prefix:N` | probe for the rollout's first N greedy plies, then play a uniform-random candidate; `prefix:0` probes nothing, the ceiling of any probe cut                                            |
| `cap:N`    | today's pick, the rollout cut after N plies and closed by `scoreLeaf` where that comes before the next turn of the Bot                                                                 |
| `memo`     | today's pick, memoised by the ply's exact state and candidates; `memo-public` keys without the libraries; `memo-count` only counts the key's recurrence                                |

- **The split** (`profile-rollout.mjs`): a V8 CPU profile of one search
  (500 µs sampling) folded by the iteration's own structure: `descent` (not
  under `rollout`: selection, expansion, determinization, the tree's moves
  and priors), and under `rollout` by its direct callee: `probes` (the greedy
  pick), `apply` (the chosen move), `enumerate`, and the rest (leaf
  evaluation, forced answers, filters). **Counts** (`run-rollout.mjs counts`):
  plies per rollout, candidates per ply, probes per rollout, on the 60 bench
  positions at 400 iterations and on field boards.
- **Field boards:** two production `expert` games' stored rows pulled by
  `field-position.mjs` for issue #10122 (games `jh74q517`, seq 258, turn 14,
  16 permanents; `jh7bkzta`, seq 217, turn 14, 14 permanents), kept out of the
  repository. A third (`jh7a571m`, 83 permanents) did not finish 60 iterations
  in 7 minutes and was dropped.
- **Speed:** on the field boards, `run-rollout.mjs speed`: every policy at 20
  iterations on the process CPU clock in one Node process, interleaved
  rounds, the first discarded. In browsers, `run-rollout-browsers.mjs`: the
  same positions in Chromium and Firefox on the wall clock, policies
  interleaved within each round, the ratio per position the median of its
  rounds.
- **Quality** (`run-rollout.mjs blade`): the blade runner's own expectation
  check (`runBladeScenario`), one seed per entry (its first declared),
  iterations only, so every arm is deterministic. Two designs:
    - _Declared budgets:_ every third `must` entry (204), each at its declared
      budget T under every policy (**equal iterations**), then every
      non-base policy at the iterations it completes in the CPU time `base`
      spent on that entry (**equal time**, read in the same process back to
      back, at most 20× T).
    - _Field budget (Gecko):_ every `must` entry at B = 71 iterations
      (`blade-at-field-budgets.md`'s Gecko budget) under every policy, then
      each non-base policy at B × its **field-board** speed-up (§ 2: `topk:2`
      1.66, `topk:3` 1.48, `prefix:3` 1.16, `cap:16` 1.13, `prefix:0` 3.28).
      A blade board's few probes would understate what a policy buys in the
      field, where that budget is spent.

    A **flip** is an entry green under `base` and red under the policy; a
    **fix** the reverse. Forced entries (no rollout under `base`) are left out.

## Results

### 1. The split: where an iteration goes

`base`, V8, 500 µs sampling; blade positions at 400 iterations (the search
stops early when the root settles), field boards at 100. Shares of the
search's samples, %.

| position                                  | iterations | ms / iteration | descent | rollout | of it: probes | apply | enumerate | rest | gc  |
| ----------------------------------------- | ---------- | -------------- | ------- | ------- | ------------- | ----- | --------- | ---- | --- |
| blade 0 (conspire copy)                   | 400        | 24.1           | 38.9    | 57.9    | 23.2          | 25.1  | 1.3       | 8.3  | 3.1 |
| blade 11 (depletion land)                 | 337        | 16.0           | 58.9    | 37.8    | 10.2          | 17.4  | 1.6       | 8.6  | 3.4 |
| blade 38 (charter fetch)                  | 325        | 28.9           | 52.5    | 44.9    | 13.2          | 18.2  | 4.8       | 8.7  | 2.5 |
| blade 52 (training lethal)                | 257        | 18.9           | 56.6    | 40.0    | 15.4          | 16.9  | 0.7       | 7.0  | 3.5 |
| field `jh74q517` (turn 14, 16 permanents) | 100        | 346.5          | 9.9     | 88.6    | **72.9**      | 5.6   | 7.8       | 2.3  | 1.5 |
| field `jh7bkzta` (turn 14, 14 permanents) | 100        | 254.1          | 11.7    | 86.7    | **66.8**      | 6.8   | 10.2      | 2.9  | 1.5 |

(ms per iteration here are profiled, sampled under load; § 2's are the speed
numbers.)

**Counts** (`base`, no profiler). The 56 bench positions with a search, at
400 iterations, p10 / median / p90 over positions; the field boards at 60
iterations:

| reading                            | blade (56)         | field `jh74q517` | field `jh7bkzta` |
| ---------------------------------- | ------------------ | ---------------- | ---------------- |
| plies per rollout (mean)           | 13.8 / 19.4 / 25.6 | 41.7             | 35.3             |
| share of plies a forced pass       | 0.03 / 0.87 / 0.89 | 0                | 0                |
| candidates per played ply          | 1.20 / 1.74 / 2.26 | 3.72             | 2.97             |
| greedy (probing) plies per rollout | 0.88 / 1.31 / 2.55 | 11.5             | 8.8              |
| candidates per greedy ply          | 2.03 / 2.18 / 3.34 | 8.4              | 6.7              |
| probes per rollout                 | 1.9 / 2.9 / 10.0   | 96               | 59               |
| CPU ms per iteration               | 4.3 / 9.0 / 19.4   | 571              | 373              |

**What the split says.** On a blade board most rollout plies are forced passes
(no enumeration, no probe), so the policy probes about three candidates per
rollout and the tree's own work dominates. Inside the descent (blade 52,
inclusive shares of the whole search): the tree's moves through the engine
22.6%, the per-node move enumeration for each sampled world (`keyedMovesFor`)
14.7%, of which `enumerateDoomedManaFloatMoves` alone 9.9%, the expansion's
priors (`computeActionPriors`) 6.7%. On a field board no ply is a forced pass:
every ply enumerates, a third of them probe 7–8 candidates, and the probes
are two thirds of the search.

### 2. Speed: what each candidate buys

**Field boards, V8, CPU per iteration ÷ `base`** (`run-rollout.mjs speed`, 20
iterations, two measured rounds), with the rollout's plies and probes:

| policy     | `jh74q517`    | `jh7bkzta`    | plies / rollout | probes / rollout |
| ---------- | ------------- | ------------- | --------------- | ---------------- |
| `base`     | 1.00 (358 ms) | 1.00 (214 ms) | 40.4 / 35.3     | 92.0 / 54.5      |
| `topk:2`   | 0.47          | 0.73          | 37.0 / 33.9     | 21.5 / 18.5      |
| `topk:3`   | 0.57          | 0.78          | 41.8 / 38.3     | 32.3 / 29.8      |
| `prefix:3` | 0.76          | 0.96          | 39.5 / 35.5     | 50.6 / 37.4      |
| `cap:16`   | 0.91          | 0.86          | 16.0 / 16.0     | 78.9 / 50.1      |
| `prefix:0` | 0.25          | 0.36          | 38.9 / 33.7     | 0 / 0            |

**Browsers, wall clock ÷ `base`** (`run-rollout-browsers.mjs`; blade
positions 0, 11, 38, 52 at 200 iterations, field `jh7bkzta` at 10, two
measured rounds; each position's ratio the median of its rounds; blade:
median over the four positions, range in brackets). `base` on the field board:
240–309 ms per iteration in Chromium, 352–383 in Firefox.

| policy     | Chromium, blade  | Chromium, field | Firefox, blade   | Firefox, field |
| ---------- | ---------------- | --------------- | ---------------- | -------------- |
| `topk:2`   | 0.98 (0.91–1.15) | 0.49            | 0.97 (0.84–1.04) | 0.43           |
| `topk:3`   | 1.04 (0.95–1.07) | 0.64            | 0.92 (0.90–0.97) | 0.62           |
| `prefix:3` | 1.00 (0.98–1.02) | 1.02            | 0.98 (0.93–1.01) | 0.79           |
| `cap:16`   | 0.90 (0.78–0.98) | 0.90            | 0.85 (0.77–0.96) | 0.80           |
| `prefix:0` | 0.81 (0.69–0.86) | 0.31            | 0.78 (0.68–1.00) | 0.31           |

**Blade boards** read the same way through the quality run's own CPU times
(§ 3, the `CPU ÷ base` column): ⟨TBD⟩

**Verdict.** ⟨TBD⟩

### 3. Quality: what each candidate loses

⟨TBD⟩

### 4. The probe memo

`memo-count` on the same searches as § 1's counts: of 100% of greedy plies,
the share whose key was already seen in the same search.

| key                              | blade (56 positions), pooled | p10 / median / p90 | field boards |
| -------------------------------- | ---------------------------- | ------------------ | ------------ |
| exact state + mover + candidates | 0.3%                         | 0 / 0 / 0          | 0 / 0        |
| the same, libraries left out     | 11.5%                        | 4% / 9% / 28%      | 0 / 0        |

Each iteration determinizes the hidden cards afresh, so a rollout ply's exact
state almost never recurs; without the libraries, a blade board's short
forced lines do recur, but those are the boards where the probes are 10–23%
of the search, so the memo could win at most 11.5% of that, about 2%,
against the cost of building a key (a `JSON.stringify` of the state per ply).
On the field boards no key recurred. **Rejected without a quality run.**

## 5. Recommendation

⟨TBD⟩

## 6. The owner's ruling

**Pending.** This note was written by an unattended pass (an `afk-pass`
job); the ruling is the owner's to give. ⟨TBD⟩

## Not measured

- **Gecko and WebKit on field boards beyond one board.** The browser speed
  reading covers one field board at 10 iterations; the V8 one, two boards at 20. A board where the probes are cheap (few candidates per ply) buys less.
- **The census at WebKit's (200) and Chromium's (313) budgets.** Only Gecko's
  71, where the loss is largest (`blade-at-field-budgets.md`), was run.
- **Every seed.** One seed per entry (the first declared), as issue #10135's
  quality run; `blade:census` runs each entry's own seeds.
- **A smarter static score.** `topk`'s score reads only a move's kind;
  ranking casts by what the card does (the evaluation's priors) is a policy of
  its own, and its cost is part of what it would have to buy back.
- **The tree's own enumeration.** `enumerateDoomedManaFloatMoves` at 9.9% of a
  blade search is a per-iteration engine cost in the descent, not the
  policy's; it is outside this slice.

## Reproduce

```bash
B=docs/research/scripts/brain-bench
node $B/run-rollout.mjs build /tmp/rollout.js
# 1. the split and the counts
node $B/profile-rollout.mjs /tmp/rollout.js /tmp/prof.json --iterations 400 0 11 38 52
node $B/profile-rollout.mjs /tmp/rollout.js /tmp/prof-field.json --iterations 100 field-jh74q517.json
node $B/run-rollout.mjs counts /tmp/rollout.js /tmp/counts.json --iterations 400 [--policy memo-count]
# 2. speed
node $B/run-rollout.mjs speed /tmp/rollout.js /tmp/speed.json --field field-jh74q517.json \
     --policies base,topk:2,topk:3,prefix:0,prefix:3,cap:16 --iterations 20 --rounds 2
node $B/run-rollout-browsers.mjs /tmp/rollout.js /tmp/browsers.json \
     --policies base,topk:2,topk:3,prefix:0,prefix:3,cap:16 --positions 0,11,38,52 \
     --iterations 200 --rounds 2 --field field-jh7bkzta.json --field-iterations 10
# 3. quality (slices in parallel, then read together)
P=base,topk:2,topk:3,prefix:0,prefix:3,cap:16
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/decl-1.jsonl --policies $P --every 3 --slice 1/4
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/gecko-1.jsonl --policies $P --budget 71 \
     --time-factors topk:2=1.66,topk:3=1.48,prefix:0=3.28,prefix:3=1.16,cap:16=1.13 --slice 1/3
node $B/summarize-rollout.mjs /tmp/decl-*.jsonl
```

A field fixture holds a real game's board and its players' ids: pull it with
`field-position.mjs` from the production checkout, never into the repository.
