# Several Brain Workers per decision: root-parallel search, measured (issue #10135)

> **Measured at** `e5571f00f`, 2026-11-18, on the development MacBook (Apple
> M1 Pro, 8 cores) while it was also the pipeline's runner: load average
> 38–138 throughout. **Dated:** every number below is as of that commit and
> that day. Slice of PRD issue #10017; the owner's ruling is § 6.

**Question.** The owner ruled (issue #10027, `expert-think-longer.md` § 5) that
`expert` must reach 400 iterations per search on every engine family. The
field Bot completes 313 per search in Chromium, 200 in WebKit and 71 in Gecko
(`blade-at-field-budgets.md`), on desktops with 5–8 cores, and a second Brain
Worker costs 1–11% when cores are free (`brain-search-off-the-dev-machine.md`
§ 4). The search is determinized ISMCTS (ADR 0000): independent trees with
distinct seeds merged at the root need no shared memory. Do several Workers
searching one decision buy the Bot what the iterations they complete suggest?

**Verdict up front.**

1. **The iterations are there.** Four Workers under one time cap complete
   **3.8x** one Worker's iterations in Chromium, **3.6x** in WebKit, **3.3x**
   in Gecko (medians); each Worker slows by 4%, 10%, 21%.
2. **Merged copies do not buy depth.** At Gecko's field budget (71 iterations
   per tree) four trees merged at the root keep **541** of 560 searched `must`
   decisions green; one tree keeps 540. On the 24 decisions that budget
   loses, four merged trees win back 5; one tree at four times the budget wins
   back 21. Across 127 sampled entries at their declared budget T, four trees
   of T/4 merged pass 124, one tree of T/4 alone 125.
3. **Splitting the root buys depth and breaks the comparison.** Four trees
   each searching a quarter of the root candidates win back 18 of the 24 —
   and turn **76** green decisions red (479 of 560): a mean read in one tree
   is not comparable with a mean read in another.
4. **Determinism holds.** A fixed seed and tree count chose the same move in
   252 of 252 re-runs; tree 0 keeps the decision's seed, so one tree is
   today's search.
5. **The ruling: not built now** (§ 6). No implementation slice is filed;
   ADR 0000 stands as written.

## Method

The bench of `brain-search-off-the-dev-machine.md` (one esbuild bundle of the
real search, every engine runs the same bytes), with a root seam patched in
AT BUNDLE TIME only (`bundle.mjs`, `rootHook`): `searchWithTrace` hands its
call to an ensemble driver, a hook may add root candidates to the root's
deny-set before the loop, and a hook may replace the grown root and its
`SearchStats` after it. `selectRootMove` and `buildTrace` then read the merge
exactly as they read one tree. Each patch must match once or the build throws.
With no hook installed the bundle searches as the unpatched one does.

**The merge rule** (`ensemble.mjs`, `mergeRoots`). Per root edge, by tree key
(every tree enumerates the same root state, so a key means the same candidate
in every tree): visits, availability, total reward and total margin summed;
the root's memoized one-ply policy value is the mean over the trees that hold
one (each read it in its own sampled world). Edges are ordered tree 0's first,
then each later tree's new keys: fixed by tree index, never by which Worker
answered first. Stats: iterations summed, elapsed time the slowest tree's,
`stoppedBy: "time"` if any tree's was. Tree k searches from
`seed + k·0x9e3779b9`; tree 0 from the decision's own seed.

**Two ensembles.** _Copies_: N trees over the whole root. _Root split_: the
root candidates, in enumeration order, dealt into min(N, candidates) groups,
tree k keeping group k mod that count (the others join its root deny-set).

**Throughput** (`run-workers.mjs`). Chromium, Firefox and WebKit through
Playwright, four Workers spawned once per engine and warmed on every position.
For each of four positions (spread by cost) and each N = 1–4, the first N
Workers search the same position at the same moment, each from its own seed,
until a 2000 ms wall-clock cap. The order of N rotates by round; one warm-up
round is discarded, three are kept. Every reading is a ratio to N = 1 within
the same round, so load drifting over minutes cancels.

**Quality** (`run-ensemble.mjs`). The blade runner's own expectation check
(`runBladeScenario`), one seed per entry (the first declared), iterations only
— no clock, so every arm is deterministic. Two designs:

- _Equal total_: 141 `must` entries (every fourth of those declaring 200, 300
  or 400 iterations), at T = the declared budget: one tree at T/4, T/2 and T;
  2 merged trees of T/2; 4 of T/4.
- _Field budget_: all 610 `must` entries at B = 71 iterations per tree
  (Gecko's field budget): one tree at B, 2B, 4B; 2 and 4 merged copies of B;
  2 and 4 split trees of B. The 2B, 4B and 2-copy arms ran only where one tree
  at B or four copies of B was red.

50 of the 610 have a forced move and no search; the tables count the other 560.

**Memory** (`memory.mjs`). Node 24.21.0 (V8 13.6), live heap after a full
collection: the bundle evaluated, and one grown root held alive against the
same heap with the root dropped. And each browser's process-tree RSS before
and after its four Workers were spawned and warmed (`run-workers.mjs`).

## Results

### 1. Iterations: N Workers under one cap

Playwright 1.62.1 (Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5),
positions 52, 11, 38, 0 of the bench (one Worker completes 936–4253 of them in
2000 ms in Chromium), 3 measured rounds, load average 85–138.

| engine   | N   | ensemble ÷ one Worker, p10 | median | p90  | per-Worker slowdown, median |
| -------- | --- | -------------------------- | ------ | ---- | --------------------------- |
| Chromium | 2   | 1.92                       | 1.99   | 2.08 | 1.01                        |
| Chromium | 3   | 2.75                       | 2.91   | 3.01 | 1.02                        |
| Chromium | 4   | 2.98                       | 3.79   | 4.10 | 1.04                        |
| Firefox  | 2   | 1.44                       | 1.96   | 2.29 | 0.99                        |
| Firefox  | 3   | 1.92                       | 2.31   | 2.86 | 1.28                        |
| Firefox  | 4   | 2.29                       | 3.29   | 4.01 | 1.21                        |
| WebKit   | 2   | 1.85                       | 2.02   | 2.50 | 0.96                        |
| WebKit   | 3   | 2.72                       | 3.02   | 3.65 | 0.99                        |
| WebKit   | 4   | 3.28                       | 3.61   | 4.43 | 1.10                        |

Read against the field: four Workers at the median ratio would complete about
1190 iterations per decision in Chromium (313 × 3.79), 720 in WebKit
(200 × 3.61) and 230 in Gecko (71 × 3.29) — past the ruling's 400 in two
families of three, if iterations were the measure. § 2 says they are not.

**Verdict: on an 8-core machine the iterations scale nearly linearly.** The
per-Worker slowdown stays within the 1–11% § 4 of the lab note measured for
two Workers, Gecko's excepted (21–28% at three and four).

### 2. Quality: what the merge keeps

**Equal total** (141 sampled entries, 127 searched; load 38–102):

| arm                 | `must` green | same move as one tree at T |
| ------------------- | ------------ | -------------------------- |
| one tree, T/4       | 125 / 127    | 124 / 127                  |
| one tree, T/2       | 126 / 127    | 126 / 127                  |
| one tree, T         | 127 / 127    | 127 / 127                  |
| 2 merged trees, T/2 | 126 / 127    | 126 / 127                  |
| 4 merged trees, T/4 | 124 / 127    | 123 / 127                  |

At their declared budgets these entries are already green at a quarter of it,
so this design cannot tell a merge from a deeper tree; it says only that
merging loses nothing it does not lose anyway (4 merged trees against one of
their own: +0 −1, Dismember's toughness entry).

**Field budget, B = 71** (610 entries, 560 searched; load 63–107):

| arm                | `must` green, all 560 | green, the 24 contested |
| ------------------ | --------------------- | ----------------------- |
| one tree, B        | 540                   | 4                       |
| one tree, 2B       | —                     | 15                      |
| one tree, 4B       | —                     | 21                      |
| 2 merged copies, B | —                     | 5                       |
| 4 merged copies, B | 541                   | 5                       |
| 2 split trees, B   | 522                   | 15                      |
| 4 split trees, B   | 479                   | 18                      |

"Contested": the 24 entries where one tree at B or four copies were red —
the decisions Gecko's field budget loses. Flips on them:

| ensemble   | against one of its trees (B) | against one tree at the same total |
| ---------- | ---------------------------- | ---------------------------------- |
| 2 copies   | +4 −3                        | +4 −14 (vs 2B)                     |
| 4 copies   | +5 −4                        | +1 −17 (vs 4B)                     |
| 2 split, B | +12 −1                       | +5 −5 (vs 2B)                      |
| 4 split, B | +15 −1                       | +2 −5 (vs 4B)                      |

and over all 560, the split trees red where one tree at B is green: **30**
(two trees), **76** (four) — Glorybringer's exert, Firebolt's flashback for
lethal, a Black Lotus kill among them.

**Verdict: copies are a variance reducer, and these decisions are not
variance-limited.** Every tree reads the same PUCT priors, so N copies open
the same root children in nearly the same order; what N adds is more
rollouts below the same shallow frontier. The field note's own reading of the
71-iteration losses is that the payoff "lies beyond what 71 iterations reach"
(`blade-at-field-budgets.md`, verdict 3) — depth, which only a deeper tree
buys. A split forces each tree past the frontier on its share, and that is why
it wins the contested decisions back; but `selectRootMove` then compares means
grown under different visit budgets and different competing children, its
visit band (`visitTol`) ranks visits that are no longer comparable, and a
candidate a tree had to itself reads better than the one a crowded tree
weighed against its rivals.

### 3. Determinism

A fixed (seed, N) reproduced its move in 252 of 252 ensemble re-runs (58 in
the equal-total design, 194 at the field budget, copies and splits). The merge
reads only the grown trees, ordered by tree index, so an iterations-only
ensemble is reproducible however its Workers are scheduled. Under the
blade's iterations-only budgets N trees of B iterations is a defined budget
(N·B iterations, B per tree); under a time cap nothing is reproducible today
either.

### 4. Memory per Worker

| what                                                | figure                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| bundle resident (engine, catalogue, blade), V8 heap | 13.1 MB                                                        |
| one grown tree, 400 iterations (5 positions)        | 0–1.4 MB, 486–607 nodes                                        |
| one grown tree, 1320 iterations                     | 0.0–2.2 MB, 1143–1905 nodes                                    |
| Chromium, process-tree RSS per warmed Worker        | 39.1 MB and 62.7 MB (two runs)                                 |
| Firefox, process-tree RSS per warmed Worker         | not measurable: 136.9 MB, then −32.7 MB                        |
| WebKit                                              | not attributable (content process is not the launcher's child) |

A tree is small next to what a Worker carries before its first search: the
cost of a Worker is its isolate and its resident catalogue, tens of MB in
Chromium. The app's Worker chunk loads the bot seat's Manifest rather than the
bench's whole catalogue (`src/lib/ai/brain-residency.ts`), so 13.1 MB of heap
is an upper bound for that part.

## 5. The design that was proposed

What an implementation would have had to decide, recorded so a later slice
starts from it rather than from scratch.

- **Merge rule.** § Method's, unchanged: sums by tree key, policy values
  averaged, tree 0 first. The seam is one function between the iteration loop
  and `selectRootMove`; no root rule changes.
- **N policy.** `N = min(4, navigator.hardwareConcurrency − 1)` (the page's
  own thread keeps a core; the judge runs on the server since issue #9528,
  so the Bot's Worker is the only Brain Worker there is), then capped by memory:
  N = 1 where `navigator.deviceMemory` reports 2 GB or less, at most 2 at
  4 GB, and at most 2 on a mobile device. A helper Worker that fails to spawn
  or dies is dropped and N shrinks; N = 1 is today's single Worker, so the
  floor is the Bot that ships.
- **Brain channel.** `brain-client.ts` serves one consult per Worker today
  (one Worker, a request-id map). Root-parallel would keep that Worker as the
  coordinator: it posts the same request with seed k to each helper, each
  helper returns its root's edge statistics only (key, visits, availability,
  reward, margin, policy value — a few numbers per candidate, never the tree),
  and the coordinator merges them into its own root before `selectRootMove`.
  A helper that has not answered when the coordinator's own search stops is
  left out of the merge, so a slow or dead helper can only make the decision
  shallower, never late.
- **Determinism and the blade.** The blade stays at N = 1: its budgets are
  per tree, and its `must` gate proves the Bot that every device can fall back
  to. An ensemble arm is a census variant (N trees of the entry's budget).
- **ADR 0000.** §1 ("a single information-set tree … on a single-threaded,
  budget-limited client") would be amended to one tree per Worker, merged at
  the root. The PIMC objection in its alternatives does not apply — every tree
  is still an information-set tree re-determinized per iteration — and the
  budget objection does not either: the extra trees run on cores that were
  idle.

## 6. The owner's ruling (2026-11-18)

Put to the owner with § 1 and § 2, the ruling: **not built now.** No
implementation slice is filed under PRD issue #10017 and ADR 0000 is not
amended. Engine speed stays the lever (ruling 1 of issue #10027): a faster
iteration deepens the one tree, and depth is what § 2 says the field Bot
lacks. A split with a sound cross-tree comparison — trees that share an anchor
set of candidates, or a final round weighing each tree's best in one tree —
was named as the open idea, and was not asked for.

## Not measured

- **A starved device.** Every reading of § 1 is on 8 cores, under a load of
  10–17 runnable threads per core: there each added Worker takes one more
  share of a contested CPU, which flatters the scaling. A four-core device
  running four Workers beside its page has no such share to take. The lab
  note's § Not measured stands: this machine cannot confine a browser to fewer
  cores.
- **Field budgets above Gecko's.** The quality design ran at B = 71 only. At
  WebKit's 200 and Chromium's 313 the contested set is smaller (11 and 7
  entries, `blade-at-field-budgets.md`); copies have no mechanism to do better
  there, and the equal-total design (B = 50–100) agrees, but it was not run.
- **Every seed.** One seed per entry; the blade's own verdict is over all its
  declared seeds.
- **Field positions.** Blade positions only; the field note measured a real
  board at four times a blade position's cost per iteration.
- **A diversified ensemble.** Trees made to differ by more than their seed —
  noise on the root priors, different exploration constants — were not tried.

## Caveats

- **Load.** 38–138 throughout. The quality arms are iteration-only and do not
  move with it; § 1's ratios are taken within a round but are read on a
  machine whose every core was oversubscribed.
- **Playwright's browser builds** are patched builds, not the release
  browsers; WebKit on macOS is not Safari on a phone.
- **RSS** is the whole browser process tree, read 3 s after the Workers were
  warmed: a collection that runs in between moves it, as Firefox's negative
  reading shows.

## Reproduce

From a bootstrapped worktree, with Playwright's three browsers installed:

```bash
B=/tmp/ensemble.js
D=docs/research/scripts/brain-bench
node $D/run-ensemble.mjs build $B

# § 1 (and the RSS rows of § 4)
node $D/run-workers.mjs $B /tmp/workers.json --cap 2000 --rounds 3 --positions 4
node $D/summarize-ensemble.mjs workers /tmp/workers.json

# § 2, equal total — four slices in parallel
for i in 1 2 3 4; do node $D/run-ensemble.mjs run $B /tmp/q$i.jsonl --slice $i/4 & done; wait
node $D/summarize-ensemble.mjs quality /tmp/q?.jsonl

# § 2, field budget: copies and deeper trees, then the splits
for i in 1 2 3 4; do node $D/run-ensemble.mjs run $B /tmp/p$i.jsonl --per-tree 71 --every 1 --repeat 10 --slice $i/4 & done; wait
for i in 1 2 3 4; do node $D/run-ensemble.mjs run $B /tmp/s$i.jsonl --per-tree 71 --every 1 --repeat 10 --slice $i/4 --arms 'split2x(B),split4x(B)' & done; wait
node $D/summarize-ensemble.mjs quality /tmp/p?.jsonl /tmp/s?.jsonl

# § 4, V8 heap
node --expose-gc $D/memory.mjs $B /tmp/mem.json
```

Equal total took about 4 minutes and each field-budget run about 10 on four
processes, at that load.
