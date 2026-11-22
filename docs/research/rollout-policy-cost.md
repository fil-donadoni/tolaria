# Rollout policy cost: what a cheaper greedy pick buys and loses (issue #10134)

> **Dated:** 2026-11-22, at `f98284f5b` (base tip), on the development MacBook
> (Apple M1 Pro, 8 cores, 16 GB) while it was also the pipeline's runner and
> another session built beside it: load average 3–125 throughout. Node 24.21.0
> (V8 13.6), Playwright 1.62.1 (Chromium 151.0.7922.34, Firefox 153.0).
> **Every number below is as of that commit, that machine and that day**,
> except the appendix: a first pass of 2026-11-19 at `0c7a640a2` on the Huawei
> runner, on two other field boards, kept apart and labelled. Slice of PRD
> issue #10017; the owner's ruling is § 6.

**Question.** The owner ruled (issue #10027, `expert-think-longer.md` § 5)
that `expert` must reach 400 iterations per search on every engine family.
Since PR #10444 (issue #10029) `expert`'s cap is 8300 ms, sized so desktop
WebKit reaches 400: 400 iterations in 8.3 s is 20.75 ms per iteration. The
field rates behind that cap (`field-reading-after-engine-changes.md`,
2026-11-19 → 21, read under the earlier 3300 ms cap) are 117 iterations per
second in Chromium, 94 on an iPhone, 48 in desktop WebKit and 28 in Gecko:
Gecko completed 94 iterations per search and would complete about 236 under
the new cap, a projection no field reading confirms yet. Per-iteration engine
work moved about 2% per change (PR #10103, PR #10100). Every rollout plays to
the start of the Bot's next turn (ADR 0015), and at every ply with more than
one candidate the greedy default policy (`selectRolloutMove`, ADR 0021) clones
the state, applies, settles and evaluates **every** candidate before playing
one. How much of an iteration is that policy, and what does a cheaper one buy
in time and lose in decisions?

**Verdict up front.**

1. **On blade boards the policy is not where the time goes; on field boards it
   is.** A blade `must` search spends 10–20% in the policy's probes and 41–60%
   in the tree's own descent (§ 1). Four late-game production boards spend
   **62–73%** in the probes and 4–11% in the descent: 7–12 probing plies per
   rollout with 5.2–8.1 candidates each (44–99 probes per rollout), against
   about 3 per rollout on a blade board. The issue's multiplier holds where
   the field Bot is slow, and nowhere else.
2. **No policy that still probes buys the order of magnitude.** Free probes
   (`prefix:0`, a uniform-random rollout) are the ceiling: 3.0–5.7× faster per
   iteration on a field board, in V8. Probing two candidates (`topk:2`) buys
   1.6–2.7×, three (`topk:3`) 1.6–2.4×, and Chromium and Firefox read the same
   ratios (§ 2). On a blade board `topk` buys 1–3%.
3. **Probing three candidates loses no tested decision.** At the declared
   budgets `topk:3` flips 0 of the 574 searched `must` entries, the same count
   as the dice alone. At Gecko's field budget of 94 iterations and equal time
   it halves the red entries (17 → 9–13, where the dice alone leave 16); at
   236, the same field rate under today's cap, it reads inside the dice.
   `topk:2` is faster and loses one tested decision in every arm. Random
   playouts and a shorter rollout lose 7–14 entries at the declared budgets,
   whole classes of them. The blade's boards are narrow, so this is a strong
   reading for narrow boards and a thin one for wide ones (§ 3).
4. **A memo of the probes is dead on arrival** (§ 4): an exact ply key
   recurs 0.3% of the time within one search; a key blind to the libraries
   12.6% on blade boards and 0–9% on the field boards where it would pay.
5. **Recommendation:** build `topk:3` as the rollout's policy, in an
   implementation slice (§ 5). It about doubles the iterations on the boards
   where the field Bot is slowest and does not reach 400 there by itself: at
   V8's rates on the four boards, 36–173 iterations per 8.3 s become about
   70–270. The owner's ruling is pending (§ 6).

## Method

The bench of `brain-search-off-the-dev-machine.md` (one esbuild bundle of the
real search, every engine runs the same bytes), with a rollout seam patched
in AT BUNDLE TIME only (`bundle.mjs`, `rolloutHook`; the source tree's
`search.ts` is untouched, so nothing here changes a default):

- `rollout` and `selectRolloutMove` become wrappers that hand their call to
  an installed hook; the ply loop reads a hook's ply cap before
  `MAX_ROLLOUT_PLIES`; every rollout ply reports itself (a forced pass, or a
  played move and its candidate count). Each patch must match once or the
  build throws; all of them matched at `f98284f5b`. With no hook installed,
  and with the `base` policy installed, the bundle picks the same moves as
  the unpatched one (three searched blade positions at 150 iterations and one
  field board at 12, compared move by move).
- **The candidate policies** (`rollout-policies.mjs`), each installed for a
  whole search and active only inside a rollout (the root's own reads of the
  greedy pick are left alone):

| policy     | what the greedy ply does                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`     | today: probe every candidate, play the best                                                                                                                                                                                         |
| `topk:K`   | rank the candidates by a static per-move-kind score (land > cast > activation / attack / block > turn face up / foretell / plot / companion > other > empty declaration > pass) and probe only the best K, `pass` always among them |
| `prefix:N` | probe for the rollout's first N greedy plies, then play a uniform-random candidate; `prefix:0` probes nothing, the ceiling of any probe cut                                                                                         |
| `cap:N`    | today's pick, the rollout cut after N plies and closed by `scoreLeaf` where that comes before the next turn of the Bot                                                                                                              |
| `memo`     | today's pick, memoised by the ply's exact state and candidates; `memo-public` keys without the libraries; `memo-count` only counts the key's recurrence                                                                             |
| `reseed`   | today's pick on another random stream (one extra draw before every rollout): the noise control, the decisions that move with nothing but the playouts' dice                                                                         |

- **The split** (`profile-rollout.mjs`): a V8 CPU profile of one search
  (500 µs sampling) folded by the iteration's own structure: `descent` (not
  under `rollout`: selection, expansion, determinization, the tree's moves
  and priors), and under `rollout` by its direct callee: `probes` (the greedy
  pick), `apply` (the chosen move), `enumerate`, and the rest (leaf
  evaluation, forced answers, filters). **Counts** (`run-rollout.mjs counts`):
  plies per rollout, candidates per ply, probes per rollout, on the 60 bench
  positions at 400 iterations and on field boards at 60.
- **Field boards:** the final stored rows of four production `expert` games
  of 2026-11-21, pulled read-only by `field-position.mjs` and kept out of the
  repository: the two Gecko games of that day and two slow Chromium games.

| board      | engine of the game | stored row | turn | permanents |
| ---------- | ------------------ | ---------- | ---- | ---------- |
| `jh7396nx` | Gecko              | seq 290    | 18   | 21         |
| `jh73x8ad` | Gecko              | seq 487    | 22   | 30         |
| `jh71n516` | Chromium           | seq 341    | 15   | 26         |
| `jh7ba584` | Chromium           | seq 249    | 14   | 21         |

- **Speed:** on the field boards, `run-rollout.mjs speed`: every policy at a
  fixed iteration count on the process CPU clock in one Node process,
  interleaved rounds, the first discarded, the ratio the median of three
  rounds. In browsers, `run-rollout-browsers.mjs`: the same positions in
  Chromium and Firefox on the wall clock, on the page's main thread, policies
  interleaved within each round, the ratio per position the median of three
  rounds. No speed reading was taken while the quality slices ran.
- **Quality** (`run-rollout.mjs blade`): the blade runner's own expectation
  check (`runBladeScenario`) on every `must` entry (634 at this sha), one seed
  per entry (its first declared), iterations only, so every arm is
  deterministic. Three runs:
    - _Declared budgets:_ each entry at its declared budget T under every
      policy (**equal iterations**), then every non-base policy at the
      iterations it completes in the CPU time `base` spent on that entry
      (**equal time**, read in the same process back to back, at most 20× T).
      "Equal time" is T × `base`'s CPU per COMPLETED iteration ÷ the policy's:
      a blade search stops early once its root's pick is settled, so total CPU
      would misstate it. Each entry is searched once untimed first (an
      entry's first search runs 10–60% slower, its cards' code cold) and the
      timed arms rotate their order by entry.
    - _Gecko's field budget, B = 94_ (`field-reading-after-engine-changes.md`:
      what a Gecko search completed under the 3300 ms cap) and _B = 236_ (the
      same field rate under today's 8300 ms cap, a projection): every entry at
      B under every policy, then each non-base policy at B × its
      **field-board** speed-up in V8, the median over the four boards (§ 2:
      `topk:2` 2.22, `topk:3` 2.09, `prefix:3` 2.02, `cap:16` 1.68,
      `prefix:0` 3.71). A blade board's few probes would understate what a
      policy buys in the field, where that budget is spent.

    A **flip** is an entry green under `base` and red under the policy; a
    **fix** the reverse; **net** is fixes − flips. Forced entries (no rollout
    under `base`) are left out. Because one seed per entry is one draw, each
    run is repeated under `reseed`: its flips and fixes are what the dice
    alone move, the floor every other row is read against.

## Results

### 1. The split: where an iteration goes

`base`, V8, 500 µs sampling; blade positions at 400 iterations (the search
stops early when the root settles), field boards at 100. Shares of the
search's samples, %. MacBook, `f98284f5b`, 2026-11-22, load about 75 (the
quality slices were running: shares hold under load, the ms column does not).

| position                                  | iterations | ms / iteration | descent | rollout | of it: probes | apply | enumerate | rest | gc   |
| ----------------------------------------- | ---------- | -------------- | ------- | ------- | ------------- | ----- | --------- | ---- | ---- |
| blade 0 (conspire copy)                   | 400        | 4.0            | 41.4    | 50.8    | 20.3          | 20.7  | 0.7       | 9.1  | 7.7  |
| blade 11 (depletion land)                 | 337        | 2.9            | 51.3    | 35.1    | 10.2          | 13.7  | 1.2       | 10.0 | 13.7 |
| blade 40 (charter fetch)                  | 324        | 6.6            | 60.0    | 31.7    | 9.9           | 11.9  | 4.4       | 5.5  | 8.4  |
| blade 54 (training lethal)                | 257        | 2.7            | 41.1    | 43.7    | 19.5          | 16.9  | 1.2       | 6.1  | 15.1 |
| field `jh7396nx` (turn 18, 21 permanents) | 100        | 78.7           | 11.0    | 80.8    | **61.7**      | 8.1   | 8.0       | 3.0  | 8.1  |
| field `jh73x8ad` (turn 22, 30 permanents) | 100        | 285.3          | 6.2     | 88.1    | **72.2**      | 4.5   | 9.4       | 2.0  | 5.7  |
| field `jh71n516` (turn 15, 26 permanents) | 100        | 198.6          | 4.0     | 92.5    | **72.6**      | 8.2   | 8.5       | 3.2  | 3.6  |
| field `jh7ba584` (turn 14, 21 permanents) | 100        | 180.7          | 7.2     | 88.1    | **69.6**      | 5.0   | 8.6       | 4.9  | 4.7  |

**Counts** (`base`, no profiler). The 53 of the 60 bench positions with a
search, at 400 iterations, p10 / median / p90 over positions; the field
boards at 60 iterations. MacBook, `f98284f5b`, 2026-11-22; the blade CPU
figure was read at load 50–77 and is indicative.

| reading                            | blade (53)         | `jh7396nx` | `jh73x8ad` | `jh71n516` | `jh7ba584` |
| ---------------------------------- | ------------------ | ---------- | ---------- | ---------- | ---------- |
| plies per rollout (mean)           | 13.8 / 19.2 / 25.2 | 27.6       | 38.6       | 44.0       | 44.1       |
| share of plies a forced pass       | 0.17 / 0.87 / 0.89 | 0          | 0          | 0          | 0          |
| candidates per played ply          | 1.20 / 1.74 / 2.27 | 2.63       | 3.83       | 2.41       | 2.13       |
| greedy (probing) plies per rollout | 0.88 / 1.31 / 2.17 | 7.5        | 12.3       | 9.3        | 9.3        |
| candidates per greedy ply          | 2.05 / 2.18 / 3.28 | 5.9        | 8.1        | 6.2        | 5.2        |
| probes per rollout                 | 1.9 / 2.9 / 7.1    | 44         | 99         | 57         | 48         |
| CPU ms per iteration               | 1.2 / 2.6 / 4.8    | § 2        | § 2        | § 2        | § 2        |

**What the split says.** On a blade board most rollout plies are forced passes
(no enumeration, no probe), so the policy probes about three candidates per
rollout and the tree's own work dominates: the probes are 10–20% of the
search, the descent 41–60%. Inside the descent (blade 54, inclusive shares of
the whole search): the tree's moves through the engine 17.2%, the per-node
move enumeration for each sampled world (`keyedMovesFor`) 9.4%, of which
`enumerateDoomedManaFloatMoves` 6.8%, the expansion's priors
(`computeActionPriors`) 6.1%. On a field board no ply takes the forced-pass
shortcut: every ply enumerates, a fifth to a third of them probe 5.2–8.1
candidates each, and the probes are **62–73% of the search**; the descent is
4–11%. The probes are densest at the start of a search: the first 20
iterations on `jh7396nx` average 85 probes per rollout, the first 60 average
44, because the first rollouts start one move under the root, in the turn
with the most options.

### 2. Speed: what each candidate buys

**Field boards, V8, CPU per iteration ÷ `base`** (`run-rollout.mjs speed`;
`base`'s own CPU per iteration in brackets; the last column is the median
over the four boards of 1 ÷ the ratio). MacBook, `f98284f5b`, 2026-11-22.

The first 20 iterations of a search (three measured rounds within ±0.03 of
each other, load 15–22):

| policy     | `jh7396nx`   | `jh73x8ad`    | `jh71n516`    | `jh7ba584`    | speed-up, median |
| ---------- | ------------ | ------------- | ------------- | ------------- | ---------------- |
| `base`     | 1.00 (84 ms) | 1.00 (260 ms) | 1.00 (185 ms) | 1.00 (162 ms) | —                |
| `topk:2`   | 0.46         | 0.45          | 0.37          | 0.47          | 2.22×            |
| `topk:3`   | 0.43         | 0.54          | 0.42          | 0.64          | 2.09×            |
| `prefix:3` | 0.59         | 0.42          | 0.30          | 0.78          | 2.02×            |
| `cap:16`   | 0.83         | 0.60          | 0.30          | 0.59          | 1.68×            |
| `prefix:0` | 0.27         | 0.27          | 0.18          | 0.33          | 3.71×            |

The first 60 iterations (two measured rounds within ±0.04, load 12–24):

| policy     | `jh7396nx`   | `jh73x8ad`    | `jh71n516`    | `jh7ba584`    | speed-up, median | probes per rollout |
| ---------- | ------------ | ------------- | ------------- | ------------- | ---------------- | ------------------ |
| `base`     | 1.00 (48 ms) | 1.00 (233 ms) | 1.00 (145 ms) | 1.00 (140 ms) | —                | 44 – 99            |
| `topk:2`   | 0.62         | 0.41          | 0.47          | 0.47          | 2.14×            | 14 – 26            |
| `topk:3`   | 0.64         | 0.50          | 0.54          | 0.59          | 1.78×            | 18 – 37            |
| `prefix:3` | 0.61         | 0.33          | 0.46          | 0.65          | 1.92×            | 19 – 21            |
| `cap:16`   | 0.82         | 0.42          | 0.35          | 0.57          | 2.08×            | 22 – 40            |
| `prefix:0` | 0.31         | 0.22          | 0.23          | 0.27          | 4.07×            | 0                  |

Every policy but `cap:16` keeps the rollout's length (28–46 plies); `cap:16`
plays 14–16. The two iteration counts bracket a field search on such a board:
at these rates `base` completes between 36 and 173 iterations in 8.3 s.

**Browsers, wall clock ÷ `base`** (`run-rollout-browsers.mjs`, three measured
rounds, each position's ratio the median of its rounds; blade: positions 0,
11, 40 and 54 at 200 iterations, median over the four, range in brackets,
load 29–36; field: the board's first 10 iterations, load 7–9). MacBook,
`f98284f5b`, 2026-11-22, Playwright's Chromium 151 and Firefox 153, the
search on the page's main thread.

| policy     | Chromium, blade  | Chromium, `jh7396nx` | Chromium, `jh71n516` | Firefox, blade   | Firefox, `jh7396nx` | Firefox, `jh71n516` |
| ---------- | ---------------- | -------------------- | -------------------- | ---------------- | ------------------- | ------------------- |
| `topk:2`   | 0.97 (0.89–1.01) | 0.30                 | 0.45                 | 1.02 (0.93–1.04) | 0.34                | 0.44                |
| `topk:3`   | 1.00 (0.91–1.01) | 0.29                 | 0.52                 | 0.98 (0.94–1.03) | 0.35                | 0.52                |
| `prefix:3` | 1.01 (0.99–1.02) | 0.51                 | 0.33                 | 1.01 (0.95–1.08) | 0.52                | 0.34                |
| `cap:16`   | 0.91 (0.75–0.92) | 0.74                 | 0.38                 | 0.90 (0.81–0.93) | 0.75                | 0.40                |
| `prefix:0` | 0.79 (0.71–0.86) | 0.18                 | 0.23                 | 0.81 (0.76–0.89) | 0.20                | 0.23                |

`base` on the two field boards: 104–114 and 88–93 ms per iteration in
Chromium, 117–121 and 123–132 in Firefox. The ratio is the reading: a
headless Firefox page's main thread runs at a low scheduler priority on this
machine, so the milliseconds are not an engine comparison. Ten iterations are
the probe-densest part of a search (§ 1), which is why these field ratios sit
below the 20- and 60-iteration ones above.

**Blade boards** read the same way through the quality run's own CPU times
(§ 3, declared budgets, equal iterations, CPU ÷ `base` at p10 / median / p90
over 574 entries): `topk:2` 0.83 / 0.97 / 1.07, `topk:3` 0.85 / 0.99 / 1.10,
`prefix:3` 0.81 / 0.98 / 1.09, `cap:16` 0.67 / 0.86 / 0.99, `prefix:0` 0.59 /
0.80 / 0.93.

**Verdict.** No policy that still probes buys the order of magnitude. Free
probes (`prefix:0`) are the ceiling: 3.0–5.7× faster per iteration on a field
board, about 4× at the median. `topk:2` buys 1.6–2.7× (median 2.1–2.2×) and
`topk:3` 1.6–2.4× (median 1.8–2.1×), and Chromium and Firefox read the same
ratios. On a blade board, where the probes are a tenth to a fifth of the
search, `topk` buys 1–3%. A shorter rollout (`cap:16`) cuts 60% of the plies
and buys 1.2–3.4×, unevenly: the probes sit in the turn the rollout starts
in, so it pays only on the boards whose later plies still probe.

### 3. Quality: what each candidate loses

634 `must` entries at `f98284f5b`, 574 of them with a search (60 are forced),
one seed each. MacBook, 2026-11-22. `reseed` is the dice alone: today's
policy on another random stream.

**Declared budgets** (each entry's own: 443 declare 400 iterations, 126
declare 200). `base` is green on all 574, so nothing can be fixed.

| policy     | flips, equal iterations | flips, equal time | iterations at equal time ÷ T, median |
| ---------- | ----------------------- | ----------------- | ------------------------------------ |
| `reseed`   | 0                       | 0                 | 1.00                                 |
| `topk:3`   | 0                       | 1                 | 1.01                                 |
| `topk:2`   | 2                       | 3                 | 1.03                                 |
| `prefix:3` | 7                       | 7                 | 1.02                                 |
| `prefix:0` | 11                      | 12                | 1.25                                 |
| `cap:16`   | 14                      | 14                | 1.17                                 |

**Gecko's field budgets.** Equal time is B × the policy's field speed-up.
The two `topk` policies are run at both readings of § 2: the 20-iteration
factor first, the 60-iteration one second. A cell is the red entries, with
flips / fixes in brackets and the iterations searched after "at".

| policy     | B = 94, equal iterations | B = 94, equal time                            | B = 236, equal iterations | B = 236, equal time                 |
| ---------- | ------------------------ | --------------------------------------------- | ------------------------- | ----------------------------------- |
| `base`     | 17                       | 17                                            | 8                         | 8                                   |
| `reseed`   | 16 (6 / 7)               | —                                             | 4 (0 / 4)                 | —                                   |
| `topk:2`   | 15 (3 / 5)               | **8** (4 / 13) at 209 · **7** (4 / 14) at 201 | 8 (2 / 2)                 | 8 (6 / 6) at 524 · 4 (3 / 7) at 505 |
| `topk:3`   | 21 (4 / 0)               | **9** (3 / 11) at 196 · **13** (5 / 9) at 167 | 8 (2 / 2)                 | 5 (2 / 5) at 493 · 3 (0 / 5) at 420 |
| `prefix:3` | 21 (6 / 2)               | 14 (9 / 12) at 190                            | 13 (6 / 1)                | 8 (5 / 5) at 477                    |
| `cap:16`   | 28 (17 / 6)              | 13 (8 / 12) at 158                            | 10 (7 / 5)                | 12 (9 / 5) at 396                   |
| `prefix:0` | 21 (13 / 9)              | 12 (10 / 15) at 349                           | 14 (11 / 5)               | 18 (16 / 6) at 876                  |

**What the tables say.**

- **`topk:3` loses nothing where iterations are plentiful.** 0 flips of 574
  at the declared budgets, the dice's own count. Its one flip at equal time
  (a redirection-shield entry) is a search run at 187 iterations instead of
  the entry's 200, because the CPU ratio measured on that entry read below
  1; at 200 it is green.
- **`topk:2` loses one tested decision in every arm.** "Holds Emperor of
  Bones' Adapt in main 1 for the beginning-of-combat exile of Atraxa" is red
  under `topk:2` in all eight of its arms (the declared budget, 94 and 236,
  at equal iterations and at every equal-time count) and green in every arm
  of `base`, `reseed` and `topk:3`. The Bot holds Emperor of Bones and five Swamps in its first
  main phase; Atraxa lies in the opponent's graveyard. The tested play is to
  pass: the Emperor's trigger at the beginning of combat exiles Atraxa, and
  Adapt then puts it onto the battlefield. Under `topk:2` the Bot activates
  Adapt at once, with nothing exiled. The likely reason, not traced here: a
  static score cannot tell two candidates of one kind apart, so among several
  choices of the same kind it keeps the first in enumeration order, and the
  playout that should exile Atraxa and adapt never does. Its other flip at
  the declared budgets (Blood Moon cast against nonbasic lands) is red at 400
  and 417 iterations and green at 94, 209, 236 and 524: an entry the blade
  already re-seeded once for noise.
- **At Gecko's 94 iterations the cheaper policy pays for itself twice.** At
  equal iterations `topk` moves fewer entries than the dice do: `topk:2`
  flips 3 and fixes 5, `topk:3` flips 4 and fixes none, where another random
  stream flips 6 and fixes 7. At equal time it halves the losses: 17 red entries become 7–8 under `topk:2` and 9–13 under `topk:3`.
  `base` needs 2.5 times the clock for the same result (8 red at 236).
- **At 236 there is nothing left to claim from one seed.** The dice alone
  move `base`'s 8 red entries to 4. `topk` at equal time reads 3–8, and the
  spread between its two iteration counts (0 against 2 flips for `topk:3`, 3
  against 6 for `topk:2`) is as wide as any difference from `base`.
- **Random playouts and a shorter rollout lose classes of decisions**, at
  the declared budgets where the dice flip nothing. `prefix:0` and `prefix:3`
  lose five sacrifice-outlet reachability entries: a random playout
  sacrifices its own board through the outlet, the failure the rollout's
  filters were written against (issue #4261). `prefix:0` also loses three
  held-answer entries. `cap:16` loses 14, the held answers and the
  hold-or-act entries among them (Snapcaster Mage held on an empty graveyard,
  Mana Drain held, Monastery Swiftspear holding the instant): a rollout cut
  before the round completes scores the Bot's action before the opponent's
  reply, the bias ADR 0015 removed. At 236 and equal time `prefix:0` is the
  worst arm (18 red against 8) with 876 iterations: more iterations of a
  random playout do not buy back what its noise costs.
- **The blade tests the cut more lightly than the field applies it.** A blade
  board is narrow (2.2 candidates per probing ply at the median, § 1), so
  `topk:3` drops 18% of the probes over the 574 entries and more than a
  quarter of them on only 59 entries; `topk:2` drops 27%, and more than a
  quarter on 122. On the four field boards `topk:3` drops 55–63% of the
  probes. "No flip" is therefore a strong statement about narrow boards and a
  thin one about wide ones (Not measured).

### 4. The probe memo

`memo-count` on the same searches as § 1's counts: of 100% of greedy plies,
the share whose key was already seen in the same search. MacBook,
`f98284f5b`, 2026-11-22.

| key                              | blade (53 positions), pooled | p10 / median / p90 | field boards, pooled | per board             |
| -------------------------------- | ---------------------------- | ------------------ | -------------------- | --------------------- |
| exact state + mover + candidates | 0.3%                         | 0 / 0 / 0          | 0%                   | 0 / 0 / 0 / 0         |
| the same, libraries left out     | 12.6%                        | 4% / 10% / 28%     | 3.8%                 | 4.2% / 9.4% / 0% / 0% |

Each iteration determinizes the hidden cards afresh, so a rollout ply's exact
state almost never recurs; without the libraries, a blade board's short
forced lines do recur, but those are the boards where the probes are 10–20%
of the search, so the memo could win at most 12.6% of that, about 2%,
against the cost of building a key (a `JSON.stringify` of the state per ply).
On the field boards the library-blind key recurs on 0–9% of the greedy plies.
**Rejected without a quality run.**

## 5. Recommendation

**Build `topk:3` as the rollout's policy**, in an implementation slice
through `/bot-change`.

- **Shape.** On a ply with more than three candidates the greedy pick probes
  `pass` and the two best by the static kind score; a ply with three or fewer
  is unchanged. Nothing above the rollout changes: the tree, the root's rules
  and the horizon of ADR 0015 stay as they are.
- **What it buys.** 1.6–2.4× the iterations on late boards, in V8 and in both
  browsers measured; 1–3% on early ones. It is the one candidate here that is
  faster and loses no tested decision.
- **What the slice still owes.** The full-seed census (`blade:census`) at the
  declared and field budgets: this note reads one seed per entry. The change
  moves every rollout's random stream, so entries pinned by noise will move
  as they do under `reseed` (6 flips and 7 fixes of 574 at 94 iterations,
  none at the declared budgets). `must` entries on wide boards, five to eight
  candidates on a ply, where the cut actually bites and the blade has few;
  the Emperor of Bones entry already separates K = 2 from K = 3. An ADR
  amending ADR 0021, whose rollout policy probes
  every candidate.

**Not K = 2.** It is 6–20% faster than K = 3 and recovers one to six more
entries at Gecko's 94 iterations, but it loses a tested decision at every
budget, the declared ones included. A rank that reads what a move does might
keep that decision at K = 2 (Not measured).

**Not random playouts, not a shorter rollout, not a memo.** `prefix:0` is the
speed ceiling and the worst arm at equal time once iterations are no longer
scarce; `cap:16` brings back the action bias; the memo's key does not recur.

**It is one factor of about two, not the target.** On the four field boards
V8 completes 36–173 iterations in 8.3 s today and would complete about
70–270 with `topk:3`. The rest has to come from levers that compose with it:
a cheaper probe (incremental evaluation, Not measured), the time the Worker
already has (`brain-pondering-tree-reuse.md`, ruling pending) and the cores
it already has (issue #10450).

## 6. The owner's ruling

**Pending.** The first pass was an unattended `afk-pass` job; the measurement was
finished on 2026-11-22 in an attended session. The ruling is the owner's. The
questions:

1. Build `topk:3` (the rollout probes `pass` and the two best-ranked
   candidates instead of every candidate) as an implementation slice under
   PRD issue #10017?
2. K = 3 as recommended, or K = 2: faster again by 6–20% and better at
   Gecko's 94 iterations, at the price of the Emperor of Bones decision until
   a better rank exists?
3. Accept the amendment of ADR 0021 (the rollout's default policy no longer
   probes every candidate) as a new ADR?

The implementation slice is filed under PRD issue #10017 once the ruling is
recorded here.

## Appendix: the first pass (Huawei runner, 2026-11-19)

An unattended pass measured the split and the speed on two other field
boards before it stopped. **Everything in this appendix is dated 2026-11-19,
at `0c7a640a2`, on the Huawei runner (Intel i7-8550U, 4 cores / 8 threads,
16 GB), load average 4–11, Node 24.21.0, Playwright 1.62.1.** The boards
(games `jh74q517`, seq 258, turn 14, 16 permanents; `jh7bkzta`, seq 217, turn
14, 14 permanents) were pulled for issue #10122 and stayed on that machine; a
third (`jh7a571m`, 83 permanents) did not finish 60 iterations in 7 minutes
and was dropped. The two machines' ratios agree; their milliseconds are not
comparable.

| reading (Huawei, 2026-11-19, `0c7a640a2`)      | `jh74q517` | `jh7bkzta` |
| ---------------------------------------------- | ---------- | ---------- |
| probes, share of the search (profile, 100 it.) | 72.9%      | 66.8%      |
| descent, share of the search                   | 9.9%       | 11.7%      |
| plies per rollout (60 iterations)              | 41.7       | 35.3       |
| greedy plies per rollout                       | 11.5       | 8.8        |
| candidates per greedy ply                      | 8.4        | 6.7        |
| probes per rollout                             | 96         | 59         |
| `base`, CPU ms per iteration (20 iterations)   | 358        | 214        |
| `topk:2`, CPU ÷ `base`                         | 0.47       | 0.73       |
| `topk:3`                                       | 0.57       | 0.78       |
| `prefix:3`                                     | 0.76       | 0.96       |
| `cap:16`                                       | 0.91       | 0.86       |
| `prefix:0`                                     | 0.25       | 0.36       |

In browsers on `jh7bkzta` at 10 iterations (two measured rounds), wall clock
÷ `base`: Chromium `topk:2` 0.49, `topk:3` 0.64, `prefix:3` 1.02, `cap:16`
0.90, `prefix:0` 0.31; Firefox 0.43, 0.62, 0.79, 0.80, 0.31. `base` was
240–309 ms per iteration in Chromium and 352–383 in Firefox.

## Not measured

- **The pooled field effect.** The field rate (28 iterations per second in
  Gecko) is an average over a game's boards. `topk` buys nothing on an early
  board and about 2× on a late one, so the pooled gain lies between and needs
  the share of a game's searches that are probe-heavy. A per-consult probe
  count in the field telemetry (issue #10321) would read it.
- **Quality on field-sized boards.** No Verdict exists for the four
  production boards, and the root move cannot stand in for one: at 60
  iterations `base` picks the same move as its own `reseed` on 2 of the 4
  boards, `topk:3` agrees with `base` on 2 of 4 and `topk:2` on 3 of 4. The
  blade's narrow boards carry the quality reading (§ 3, last bullet); wide
  `must` entries are the implementation slice's to add.
- **Every seed.** One seed per entry (the first declared), as issue #10135's
  quality run; `blade:census` runs each entry's own seeds. The `reseed` row
  bounds what one seed can hide, it does not replace the census: the
  implementation slice owes it.
- **WebKit, and Gecko on more boards.** The browser reading covers two field
  boards at 10 iterations in Chromium and Firefox; the V8 one, four boards at
  20 and 60.
- **A smarter rank.** `topk`'s score reads only a move's kind, ties in
  enumeration order. Ranking by what the move does (the priors the tree
  already computes for its own expansion) might let K = 2 keep the decisions
  it loses here; its cost is part of what it would have to buy back.
- **Incremental evaluation.** Every probe evaluates its board from scratch,
  and the candidates of one ply share almost all of it: `evaluate` is 24–33%
  of the search on the field boards (sampled V8 profile, comment of
  2026-11-21 on issue #10134). Making each probe cheaper is a separate lever
  from making fewer of them, and the two compose. Not measured here.
- **The tree's own enumeration.** `enumerateDoomedManaFloatMoves` at 6.8% of
  a blade search is a per-iteration engine cost in the descent, not the
  policy's; it is outside this slice.
- **Games.** The blade's `must` tier is tested decisions, not strength over a
  game. No self-play was run (ADR 0138: the ladder is an unowed experiment).

## Reproduce

```bash
B=docs/research/scripts/brain-bench
node $B/run-rollout.mjs build /tmp/rollout.js
# 1. the split and the counts
node $B/profile-rollout.mjs /tmp/rollout.js /tmp/prof.json --iterations 400 0 11 40 54
node $B/profile-rollout.mjs /tmp/rollout.js /tmp/prof-field.json --iterations 100 field-jh7396nx.json
node $B/run-rollout.mjs counts /tmp/rollout.js /tmp/counts.json --iterations 400 [--policy memo-count]
node $B/run-rollout.mjs counts /tmp/rollout.js /tmp/counts-field.json --iterations 60 \
     --field-only --field field-jh7396nx.json [--policy memo-count]
# 2. speed
P=base,topk:2,topk:3,prefix:0,prefix:3,cap:16
node $B/run-rollout.mjs speed /tmp/rollout.js /tmp/speed.json --field field-jh7396nx.json \
     --policies $P --iterations 20 --rounds 3
node $B/run-rollout-browsers.mjs /tmp/rollout.js /tmp/browsers.json \
     --policies $P --positions 0,11,40,54 \
     --iterations 200 --rounds 3 --field field-jh7396nx.json --field-iterations 10
# 3. quality (slices in parallel, then read together)
F=topk:2=2.22,topk:3=2.09,prefix:0=3.71,prefix:3=2.02,cap:16=1.68
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/decl-1.jsonl --policies $P --slice 1/4
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/g94-1.jsonl --policies $P --budget 94 \
     --time-factors $F --slice 1/4
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/g236-1.jsonl --policies $P --budget 236 \
     --time-factors $F --slice 1/4
# the noise control: the same three runs under another random stream
node $B/run-rollout.mjs blade /tmp/rollout.js /tmp/noise-94-1.jsonl --policies base,reseed \
     --budget 94 --time-factors reseed=1 --slice 1/4
node $B/summarize-rollout.mjs /tmp/decl-*.jsonl
```

A field fixture holds a real game's board and its players' ids: pull it with
`field-position.mjs` from the production checkout, never into the repository.
