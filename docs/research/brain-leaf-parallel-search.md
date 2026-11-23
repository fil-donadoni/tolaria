# Rollouts on helper Workers, one tree: leaf-parallel search, measured (issue #10450)

> **Measured at** `2b498130ae` (base tip), 2026-11-22, on the development
> MacBook (Apple M1 Pro, 8 cores, 16 GB) while it was also the pipeline's
> runner: load average 14.7–111.7 throughout. Node 24.21.0 (V8 13.6),
> Playwright 1.62.1 (Chromium 151.0.7922.34, Firefox 153.0, WebKit 26.5).
> **Dated:** every number below is as of that commit, that machine and that
> day. Slice of PRD issue #10017; the owner's ruling is § 7.

**Question.** The owner ruled (issue #10027, `expert-think-longer.md` § 5)
that `expert` must reach 400 iterations per search on every engine family.
Root-parallel search — N trees merged at the root — buys iterations and not
depth, and was ruled "not built now" on 2026-11-18
(`brain-root-parallel-search.md` § 6): the trees cannot be compared across
Workers. Here there is ONE tree and one set of statistics. Only the playout
after the tree ends (the rollout) leaves the Worker, and on a late-game field
board that playout is most of an iteration: 81–93% of a search's samples in
V8 (`rollout-policy-cost.md` § 1), 62–73% of them in the greedy pick's probes.
How many iterations does one coordinator with K helpers complete, what does
the hand-off cost, what does batching cost in decisions, and what is left of
it beside a cheaper rollout?

**Verdict up front.**

1. **On a field board the iterations are there.** Under `expert`'s 8300 ms
   cap, four helpers with K = 4 leaves in flight complete **2.4–2.9×** one
   Worker's iterations in Chromium, **1.6–2.5×** in Firefox and **1.9–2.7×**
   in WebKit (medians over four production boards, three passes). That is
   head-of-line blocking: the coordinator waits on the oldest leaf, and
   helpers that have finished stand idle. Letting **16 leaves** fly on the
   same four helpers reads **4.05×**, **3.31×** and **4.09×**: 104 → 429
   iterations per decision in Chromium, 84 → 279 in Firefox, 80 → 317 in
   WebKit, on the four slowest boards the field Bot meets. A helper's own
   rollout slows by 0–34% at K = 4.
2. **On a blade board it buys nothing outside Chromium.** The rollout there
   costs 0.3–2 ms, and the hand-off costs what the THREAD HOP costs, not what
   the clone costs. One rollout round-tripped through a helper adds 0.5–0.9 ms
   per iteration in Chromium, 2–4 ms in Firefox and 5–8 ms in WebKit. Four
   helpers read 1.2–1.3× in Chromium and 0.3–1.5× in the other two. A
   structured clone of the world is 0.1–0.3 ms on a blade board, 0.3–0.8 ms on a
   field board: 0.2–2% of a field rollout. Sending the seed and the path
   instead costs 0.02–0.06 ms to post and a replay in the helper of
   0.1–1.7 ms on a blade board and 0.2–4.4 ms on a field board. It
   does no better per rollout and needs the root state once per search
   (0.1–0.8 ms, once). The break-even lies under the cheapest rollout
   measured in Chromium (blade, 0.3–2 ms, gains 1.2–1.3×). In Firefox and
   WebKit it lies between a blade rollout (0.6–1.7 ms, 0.3–1.5×) and a field
   one (15–180 ms, gains everywhere). These boards cannot narrow it further.
3. **Batching costs a few decisions, and the iterations buy them back.** At
   equal iterations the batch rule moves no more entries than the dice do at
   Gecko's field budget of 94: 19 red at K = 4 against 17 for today's search
   and 18 on re-seeded dice. At 236 it costs 5–7: 11 red against 4. At **equal
   time** against one Worker, at Firefox's measured gains, 18 red entries at
   94 become **10** (K = 3, 166 iterations) and **11** (K = 4, 150). One
   tree given the same iterations reads 7 and 8. At 236, 4 red become 3 and 5.
   One tree at those counts reads 1. The census (every declared seed,
   2773 searches at 94) agrees: 76 red seeds for today's search, 81 on
   re-seeded dice, **53** for K = 3 at equal time, and 556 entries green on
   every seed against 545.
4. **Determinism holds by construction.** Rewards go into the tree in dispatch
   order. A fixed (seed, K) reproduced its settle hash and its move on every
   position checked, under both transports and in a fresh thread. K = 1
   reproduces K = 0 exactly.
5. **The ceiling is high today and lower beside a cheaper rollout.** The
   coordinator's own work per iteration (the descent, the post, the settle)
   bounds the gain at **5–20×** on the field boards with today's rollout policy.
   With `topk:3` (`rollout-policy-cost.md`, built in issue #10473) it falls to
   **2.2–11×**, and on the lightest board to 2.2–3.1×: from K = 3 on, that board
   is the coordinator's. On blade boards the bound is 0.8–1.7×.
6. **The lag is what fills the helpers.** At L = K a helper is busy 60–69%
   of a field search; at L = 16, 93–94%. The tree is a function of (seed, L)
   whatever the helper count, so L is a quality knob as much as K is:
   at Gecko's 94 and equal time, L = 8 leaves **7** of 18 red and
   L = 16 leaves 9, where L = K = 4 leaves 11. One tree given those
   iterations reads 1 and 0. At 236, scaled to 729–781 iterations, every arm
   reads 8–11, the single tree included: past what one seed can tell apart.
7. **Proposal** (§ 6): build it for field-sized rollouts only, behind an
   adaptive gate, with `min(4, cores − 2)` helpers, eight leaves in flight (L = 2K) and no
   helper on a phone.
   The coordinator loop becomes resumable and asynchronous rather than
   blocking on a `SharedArrayBuffer`: cross-origin isolation would put COEP on
   the app and its cross-origin card art. It amends ADR 0000 § 1. **For the
   owner to rule** (§ 7).

## Method

The bench of `brain-search-off-the-dev-machine.md` (one esbuild bundle of the
real search, every engine runs the same bytes), with a leaf seam patched in AT
BUNDLE TIME only (`bundle.mjs`, `leafHook`; the source tree's `search.ts` is
untouched, so nothing here changes a default):

- the two rollout sites of the descent (`puctDescend`'s expansion and
  `iterate`'s) hand the leaf to a driver; `iterate` determinizes from a
  generator the driver hands it, and reports the moves the descent applies;
  after the iteration loop the driver settles or drops what is still in
  flight. Each patch must match its stated count or the build throws; all of
  them matched at `2b498130ae`.
- **The batch rule** (`leaf-parallel.mjs`). Leaf n is descended; a **virtual
  loss** goes on its path (every edge one more visit at reward 0 for its
  mover, so the next descents steer round it); its rollout is dispatched.
  Once K leaves are in flight the OLDEST is settled: its virtual visit taken
  off, its real reward backpropagated. Leaf n is therefore chosen without the
  results of the K − 1 before it, and the rewards go into the tree in
  **dispatch order**, whatever order the helpers answer in. K = 1 is the
  search of K = 0 with its rollouts done one at a time on a helper: the
  hand-off's cost alone, nothing overlapped.
- **Seeds.** Under the seam each iteration's world is drawn from its own
  generator (one u32 from the search's stream before `determinize`) and each
  rollout from its own (one u32 at dispatch), so where a rollout runs cannot
  change what it returns. That re-seeding alone is the **`k0s`** arm: the seam
  at K = 0, today's search on other dice — the control every K is read
  against, as `reseed` was in `rollout-policy-cost.md`.
- **Two transports** for a helper's world: **`clone`**, the determinized world
  itself, structured-cloned by `postMessage` per rollout; **`replay`**, the
  root state once per search, then per rollout the world's seed and the
  descent's moves (2 at the median), from which the helper determinizes the
  same world and replays the path itself.
- **The browser prototype** (`run-leaf-browsers.mjs`). The search loop is
  synchronous, so the coordinator BLOCKS on a helper's answer: helpers write
  each reward into a `SharedArrayBuffer` and wake it with `Atomics.notify`,
  the coordinator `Atomics.wait`s on the oldest leaf's slot. A
  `SharedArrayBuffer` needs a cross-origin-isolated page, so the page and the
  Worker script are served from 127.0.0.1 with COOP `same-origin` and COEP
  `require-corp`; all three engines reported `crossOriginIsolated` in the page,
  the coordinator and every helper. The page wires one `MessageChannel` from
  the coordinator to each helper (no nested Workers). Per engine one
  coordinator and four helpers are spawned once and warmed; then per board,
  per round (one warm-up round discarded, three kept), every arm in an order
  rotating by round — `base` (today's search, no seam), `k0s`, `clone1`–`4`,
  `replay1`–`4` — from the round's seed until the cap: **2000 ms** on blade
  positions 0, 11, 40 and 54 (those of `rollout-policy-cost.md`), **8300 ms**
  (`expert`'s cap since PR #10444) on the four field boards. A rollout
  still in flight at the cap is dropped (its virtual loss taken off, nothing
  backpropagated) and the coordinator waits for every helper to be idle
  before the next search, outside the timed one. One rollout can cost ten
  times the next on a field board (the first ones start in the turn with the
  most options), so the seed changes by round and every reading is a ratio
  to `k0s` in the same round, its median over the rounds. A second pass
  repeated K = 4 for both transports; a third measured the lag (§ 1), at
  L = 4, 8 and 16 on four helpers.
- **The hand-off** (`entry-leaf.mjs`'s `handoff`, in Node and in each
  browser's coordinator Worker): a search at K = 2 whose executor times, for
  every leaf, a `structuredClone` of the world (what `postMessage` pays to
  serialise and deserialise, without the thread hop), the determinize-and-
  replay a `replay` helper does, and the rollout; and once per search the
  root state's clone. The browser runs also record what the coordinator spent
  inside `postMessage` and what a helper spent reading `event.data`.
- **Field boards:** the four production `expert` boards of
  `rollout-policy-cost.md` (stored rows of 2026-11-21, pulled read-only by
  `field-position.mjs`, kept out of the repository).

| board      | engine of the game | stored row | turn | permanents |
| ---------- | ------------------ | ---------- | ---- | ---------- |
| `jh7396nx` | Gecko              | seq 290    | 18   | 21         |
| `jh73x8ad` | Gecko              | seq 487    | 22   | 30         |
| `jh71n516` | Chromium           | seq 341    | 15   | 26         |
| `jh7ba584` | Chromium           | seq 249    | 14   | 21         |

- **The checks** (`run-leaf.mjs check`), before anything was read off the
  seam, on blade positions 0, 11, 40, 54 at 150 iterations and `jh7396nx` at
  10: with no hook installed the leaf bundle picks the plain bundle's move at
  the same completed count; K = 1 applies the same rewards in the same order
  as `k0s` (same settle hash) and picks the same move; at K = 2–4 every
  rollout run from a structured clone and from the replayed seed and path
  returned exactly what the coordinator's own world returned; a repeated
  (seed, K) reproduced its settle hash and move, under both transports. And
  in a Node `worker_thread` holding its own copy of the bundle (a fresh
  module state, as a helper has), every rollout of `jh7396nx`'s first eight
  returned the coordinator's reward and margin to the bit, under both
  transports.
- **Quality** (`run-leaf.mjs blade`): the blade runner's own expectation check
  (`runBladeScenario`), iterations only — no clock, every arm deterministic —
  on the batch rule run in one thread (`localExecutor`: the rollouts of the
  K in flight are run at settle time, the tree sees exactly what it would see
  with K helpers). Arms: `base` (today's search, no seam), `k0s`
  (the control), `kN` (N leaves in flight at the same iterations) and
  `kN@time=F` (N in flight at F × the iterations, F the gain measured in
  Firefox on the field boards: 1.77 at K = 3, 1.60 at K = 4), with
  `k0@time=F` beside each one. That last arm is today's search on the same
  dice given the same iterations: a deeper single tree, the reference an
  equal-time arm is read against. Budgets: each entry's declared one (every
  fourth entry, first seed); Gecko's field budget of 94 and its projection to
  236 under today's cap (`rollout-policy-cost.md`), every entry, first seed;
  and the **census**: every declared seed of every entry at 94. A forced entry
  (nothing rolled out) is left out. The lag arms (`k8`, `k16`: eight and
  sixteen leaves in flight) are read as batching arms of their own, since
  the tree depends only on how many leaves fly, at Firefox's third-pass
  gains of 3.09 (L = 8) and 3.31 (L = 16).

## Results

### 1. Iterations: K helpers under one cap

First pass, load 30–112. Ratio to `k0s` in the same round, median over
three rounds per board, then median (range) over the four boards. `k0s`
iterations per decision in brackets. `base` read 0.95–0.99 of `k0s` in
Chromium and Firefox and 0.82–0.95 in WebKit, which is the dice.

| engine   | boards | `k0s`    | `clone1` | `clone2` | `clone3` | `clone4`             | `replay1` | `replay2` | `replay3` | `replay4`            |
| -------- | ------ | -------- | -------- | -------- | -------- | -------------------- | --------- | --------- | --------- | -------------------- |
| Chromium | field  | 1 (96)   | 0.91     | 1.55     | 2.12     | **2.57** (2.39–2.61) | 0.96      | 1.51      | 2.07      | **2.44** (2.41–2.69) |
| Firefox  | field  | 1 (77)   | 0.85     | 1.28     | 1.70     | **1.57** (1.47–1.96) | 0.82      | 1.43      | 1.77      | **1.60** (1.57–1.82) |
| WebKit   | field  | 1 (76)   | 0.78     | 1.35     | 1.79     | **2.46** (1.72–2.60) | 0.81      | 1.34      | 1.59      | **1.95** (1.85–2.75) |
| Chromium | blade  | 1 (1999) | 0.68     | 1.06     | 1.16     | 1.24 (1.02–1.42)     | 0.51      | 1.00      | 1.27      | 1.30 (1.05–1.58)     |
| Firefox  | blade  | 1 (1368) | 0.21     | 0.47     | 0.44     | 0.46 (0.44–0.81)     | 0.34      | 0.62      | 0.84      | 0.88 (0.86–1.03)     |
| WebKit   | blade  | 1 (1000) | 0.15     | 0.23     | 0.29     | 0.45 (0.28–0.88)     | 0.24      | 0.46      | 0.32      | 0.34 (0.30–0.96)     |

Second pass at K = 4, load 15–74, both transports:

| engine   | boards | `k0s`    | `clone4` (range) | `replay4` (range) |
| -------- | ------ | -------- | ---------------- | ----------------- |
| Chromium | field  | 1 (104)  | 2.57 (2.46–2.93) | 2.57 (2.50–2.84)  |
| Firefox  | field  | 1 (80)   | 1.91 (1.85–2.21) | 2.10 (1.97–2.38)  |
| WebKit   | field  | 1 (71)   | 2.40 (2.01–2.56) | 2.62 (2.16–3.09)  |
| Chromium | blade  | 1 (2086) | 1.26 (1.07–1.48) | 1.22 (1.07–1.50)  |
| Firefox  | blade  | 1 (1392) | 1.04 (0.94–1.19) | 1.12 (1.04–1.40)  |
| WebKit   | blade  | 1 (1001) | 0.41 (0.01–0.61) | 1.02 (0.91–1.12)  |

**Per-helper slowdown** (a helper's mean rollout at K over the same
transport's at K = 1, field boards pooled, first pass): Chromium 0.97–1.00
(clone) and 1.04–1.07 (replay); Firefox 1.06–1.34 and 1.07–1.28; WebKit
0.97–1.06 and 1.06–1.17, the worst at K = 4 each time.

**Where the time goes at K = 4 on a field board.** The coordinator waits
for a reward 80–89% of the search, yet a helper is busy with its rollout
only 60–69% of it. Rewards go in in dispatch order, so the coordinator waits
on the OLDEST leaf. One rollout can cost five times the next (p10 to p90),
so while it waits on a long one the helpers that have finished stand idle:
head-of-line blocking.

**The lag** (`leaf-parallel.mjs`): let L > K leaves fly on K helpers. A job
goes to the helper with the fewest outstanding, rewards still go in in
dispatch order, and the tree is a function of (seed, L) alone (checked: four
helpers at L = 8 apply the rewards of K = 8, settle hash for settle hash).
Third pass, clone transport, four helpers, load 8.5–25:

| engine   | boards | `k0s`    | L = 4 (range)    | L = 8 (range)    | L = 16 (range)       | helper busy, L = 4 / 8 / 16 |
| -------- | ------ | -------- | ---------------- | ---------------- | -------------------- | --------------------------- |
| Chromium | field  | 1 (104)  | 2.85 (2.66–2.90) | 3.57 (3.51–3.82) | **4.05** (3.90–4.68) | 65% / 84% / 94%             |
| Firefox  | field  | 1 (84)   | 2.46 (2.21–2.55) | 3.09 (3.05–3.17) | **3.31** (3.00–3.41) | 68% / 84% / 93%             |
| WebKit   | field  | 1 (80)   | 2.69 (2.37–2.90) | 3.66 (3.50–4.09) | **4.09** (3.96–4.31) | 61% / 82% / 93%             |
| Chromium | blade  | 1 (2104) | 1.27 (1.08–1.63) | 1.29 (1.09–1.67) | 1.29 (1.10–1.76)     | 13% at every L              |
| Firefox  | blade  | 1 (1358) | 1.23 (1.07–1.47) | 1.46 (1.10–1.66) | 1.36 (1.13–1.52)     | 19–20%                      |
| WebKit   | blade  | 1 (1157) | 0.53 (0.50–0.85) | 0.51 (0.47–1.64) | 1.15 (1.10–1.79)     | 9% / 17% / 10%              |

At L = 16 that is 104 → 429 iterations per decision in Chromium, 84 → 279
in Firefox and 80 → 317 in WebKit (medians). It is above 400 in Chromium on
these boards, and the gain is about K, the number of helpers: four.

**Verdict.** On the boards where the field Bot is slow, four helpers at
L = K about double to triple the iterations; with a lag of 16 they reach
3.3–4.1×. The lag is the larger half of the gain on a field board and
nothing on a blade board, where the coordinator's own descent is the limit
(it waits 0–5% of the search). Firefox gains least and its helpers slow
most. On blade boards Chromium gains 1.2–1.3× and the others 0.4–1.5×,
inside their noise. K = 1 loses everywhere: 9–49% on a field board under a
time cap, 32–85% on a blade board.

### 2. The hand-off: what crosses the boundary

Per rollout, medians, each engine's coordinator Worker (Node for V8) at
K = 2: blade positions at 200 iterations, field boards at 20 (30 in Node).
Wall clock under load, so the rollout column is not an engine comparison.
The ratios are the reading.

| engine    | board                    | world KB | path moves | clone ms | replay ms | rollout ms | clone ÷ rollout | replay ÷ rollout |
| --------- | ------------------------ | -------- | ---------- | -------- | --------- | ---------- | --------------- | ---------------- |
| Chromium  | blade 0 (conspire)       | 13       | 5          | 0.10     | 0.15      | 0.8        | 12.5%           | 18.7%            |
| Chromium  | blade 40 (charter fetch) | 23       | 20         | 0.18     | 0.47      | 0.4        | 42.5%           | 109%             |
| Chromium  | field `jh7396nx`         | 38       | 1          | 0.29     | 0.27      | 15.0       | 1.9%            | 1.8%             |
| Chromium  | field `jh73x8ad`         | 40       | 1          | 0.33     | 0.37      | 133        | 0.3%            | 0.3%             |
| Firefox   | blade 0                  | 13       | 5          | 0.18     | 0.30      | 1.7        | 10.7%           | 17.9%            |
| Firefox   | field `jh71n516`         | 40       | 2          | 0.42     | 0.68      | 83.4       | 0.5%            | 0.8%             |
| WebKit    | blade 0                  | 13       | 5          | 0.18     | 0.30      | 1.5        | 12.0%           | 20.0%            |
| WebKit    | field `jh7ba584`         | 38       | 1          | 0.48     | 0.28      | 100        | 0.5%            | 0.3%             |
| V8 (Node) | field `jh73x8ad`         | 40       | 1          | 0.75     | 1.29      | 1731       | 0.04%           | 0.07%            |

Over all eight boards and four engines: a clone is 0.08–0.34 ms on a blade
board (11–23 KB) and 0.26–0.75 ms on a field board (38–40 KB). A replay is
0.10–1.66 ms on a blade board, where the path runs 5–20 moves deep, and
0.21–4.40 ms on a field board. The root state's one clone per search is
0.08–0.81 ms (35.9 and 30.4 ms in Node on two boards, once each: a collection
in the clone). In the browsers' live runs the coordinator spent 0.07–0.37 ms
inside `postMessage` per `clone` rollout and 0.02–0.06 ms per `replay` one.

**The cost that matters is the hop.** K = 1 grows exactly the tree of `k0s`,
so its extra wall time per iteration is the whole hand-off: post, delivery,
wake-up, receive and the reward's return. Blade boards: Chromium 0.50 ms
(clone) / 0.91 ms (replay), Firefox 3.67 / 2.25 ms, WebKit 7.58 / 5.00 ms.
Field boards, noisier: Chromium 5.0 / 2.4, Firefox 16.8 / 20.1, WebKit
18.8 / 7.6. The hop is mostly not the clone (a tenth of it or less), and it
is longest in Firefox and WebKit.

**Verdict and the break-even.** Neither transport costs more than the other
in a way that decides anything. `clone` is simpler: no root state to ship,
no replay to keep in step with the descent. `replay` posts a hundredth of
the bytes and pays for it with a replay that grows with the path. A helper
pays for itself when its rollout is long against the hop. From the two
tables, every board gained at K = 4 in Chromium, the cheapest rollouts
included (0.3–2 ms): its break-even is under them. In Firefox and WebKit the
blade boards' 0.6–1.7 ms rollouts read 0.3–1.5× (worse under the heavier
load of the first pass) and the field boards' 15–180 ms ones gain: the
break-even lies between, closer than these boards can say. **Every field board
(15–180 ms rollouts, 38–40 KB worlds, 21–30 permanents) is above it on every
engine; every blade board (0.3–2 ms, 11–23 KB) is below it in Firefox and
WebKit.** Rollout cost, not world size, decides it: the world is 3× larger
on a field board than on a blade board, and its rollout 20–100× longer.

### 3. Quality: what batching costs

Iterations only, one thread (Method). Red entries; flips / fixes against
`k0s` in brackets.

| budget                             | `base` | `k0s` | K = 2      | K = 4      | lag 8       |
| ---------------------------------- | ------ | ----- | ---------- | ---------- | ----------- |
| declared, every 4th (141 searched) | 0      | 0     | 0          | 1 (1 / 0)  | —           |
| 94, all (576 searched)             | 17     | 18    | 11 (0 / 7) | 19 (7 / 6) | 10 (2 / 10) |
| 236, all (576 searched)            | 8      | 4     | —          | 11 (7 / 0) | 9 (6 / 1)   |

At equal time against one Worker (Firefox's field gains), with one tree at
the same iterations beside each:

| budget | `k0s` at B | K = 3 at 1.77 B      | one tree at 1.77 B | K = 4 at 1.60 B      | one tree at 1.60 B |
| ------ | ---------- | -------------------- | ------------------ | -------------------- | ------------------ |
| 94     | 18         | **10** (5 / 13), 166 | 7 (2 / 13)         | **11** (5 / 12), 150 | 8 (2 / 12)         |
| 236    | 4          | **3** (3 / 4), 418   | 1 (1 / 4)          | **5** (5 / 4), 378   | 1 (1 / 4)          |

**The lag at equal time** (Firefox's third-pass gains, 3.09 at L = 8 and
3.31 at L = 16; `k0s` reads 18 and 4):

| budget | L = 16 at B | L = 8 at 3.09 B     | one tree at 3.09 B | L = 16 at 3.31 B    | one tree at 3.31 B |
| ------ | ----------- | ------------------- | ------------------ | ------------------- | ------------------ |
| 94     | 17 (8 / 9)  | **7** (4 / 15), 290 | 1 (0 / 17)         | **9** (6 / 15), 311 | 0 (0 / 18)         |
| 236    | 8 (5 / 1)   | 10 (9 / 3), 729     | 8 (7 / 3)          | 11 (10 / 3), 781    | 8 (7 / 3)          |

**The census**: every declared seed of every entry at 94, 2773 searches
(3080 jobs, 307 forced), K = 3 at equal time:

| arm                   | red seeds | flips / fixes vs `k0s` | entries green on every seed (of 576) |
| --------------------- | --------- | ---------------------- | ------------------------------------ |
| `base`                | 76        | 29 / 34                | 545                                  |
| `k0s`                 | 81        | —                      | 544                                  |
| K = 3 at 1.77 B (166) | **53**    | 23 / 51                | **556**                              |

**What the tables say.**

- **At 94 iterations the batch rule is inside the dice.** Today's search and
  re-seeded dice differ by 6 flips and 5 fixes. K = 4 differs from `k0s` by 7
  and 6, K = 2 and lag 8 by fewer flips than fixes. The red entries move
  between seeds; the count does not.
- **At 236 it costs a few entries.** K = 4 flips 7 of `k0s`'s green entries
  and fixes none. Lag 8 flips 6. At that budget the dice alone move 1–5, so
  this is the batch rule's own cost: leaves chosen blind to the K − 1 before
  them, on entries whose answer is a few plies deep. Among those entries:
  Entomb's target, the self-tap source, the saddle-or-attack choice, and the
  as-enters haste choice.
- **At equal time the iterations are worth more than batching costs.** At
  94, K = 3 and K = 4 recover 7–8 of the 18 red entries. A single tree given
  the same iterations, which is what a faster engine would buy, recovers
  10–11. So batching keeps about two-thirds to three-quarters of what its
  iterations would be worth in one tree. At 236 K = 3 is ahead of `k0s` by
  one entry and K = 4 behind by one, both inside the dice; the deeper single
  tree reads 1.
- **The lag buys iterations at a price in the tree.** At 94, L = 8 at its
  equal time leaves 7 red, ahead of K = 4's 11, and L = 16 leaves 9. A
  single tree at the same counts leaves 0–1: sixteen blind leaves cost more
  than eight. At 236 × 3.1–3.3 every arm reads 8–11, the single tree
  included (more iterations turn some entries red, as Blood Moon's did in
  `rollout-policy-cost.md`), so that row says nothing about the lag.
- **The declared budgets are not the measure.** Every searched entry there
  is green under `base`, `k0s` and K = 2. K = 4 loses one, the self-tap
  source entry, also red at 236.

### 4. Determinism, memory and fallback

- **The rule.** Rewards go into the tree in dispatch order, and leaf n is
  descended with exactly the results of leaves ≤ n − K applied and the
  virtual losses of the K − 1 before it. What the tree sees is fixed by
  (seed, K), never by which helper answered first. Each rollout's generator is
  seeded at dispatch from the search's stream, so the helper that runs it
  cannot change its reward.
- **Checked.** A fixed (seed, K) repeated gave the same settle hash and move
  on every target of the checks, at K = 2, 3, 4, under both transports. A
  fresh-thread helper (a Node `worker_thread` with its own module state)
  returned every reward to the bit. K = 1 reproduced `k0s`, settle hash and
  move.
- **The blade's budgets under K.** An iterations-only budget of T at K means
  T leaves dispatched, all settled before the root is picked: a defined,
  reproducible search, NOT today's search on T iterations. The blade stays at
  K = 0: its `must` gate proves the Bot every device falls back to. K is a
  census variant, `kN@time=F` the arm that reads it.
- **A time cap** stops with up to K − 1 rollouts in flight. They are dropped
  (virtual loss off, nothing backpropagated), so a helper can make a decision
  shallower, never late. Under a time cap nothing is reproducible today either.

**Memory and fallback.**

- **What a helper holds.** The engine and the card definitions the
  rollouts meet. A rollout plays both seats, so a helper needs the same
  residency as the Brain Worker: every Manifest entry primed for the game,
  re-posted to each helper as `brain-client.ts` re-posts them to a fresh
  Worker. It holds no tree: the tree stays in the coordinator (0–2.2 MB at
  400–1320 iterations, `brain-root-parallel-search.md` § 4).
- **The figure.** `brain-root-parallel-search.md` § 4 stands: 13.1 MB of V8
  heap for the bench's whole catalogue, and 39–63 MB of process-tree RSS per
  warmed Worker in Chromium. Here the same reading gave 1.7 MB and then
  155 MB per Worker in Chromium, and 30–123 MB in Firefox, across three runs:
  RSS on this machine under memory pressure measures the compressor, not the
  Worker. `performance.measureUserAgentSpecificMemory` is not exposed by
  Playwright's Chromium even on the isolated page. **Budget 40–65 MB per
  helper**, the earlier reading, until a device reads one.
- **Fallback.** A helper that fails to spawn, errors or stops answering is
  dropped and K shrinks. Its in-flight leaves are re-run in the coordinator in
  dispatch order, so the tree stays what (seed, K) makes it; a decision is
  late by at most one rollout. K = 0 is today's single Worker, so the floor
  is the Bot that ships.

### 5. The ceiling beside a cheaper rollout

With K large enough, the coordinator is the limit: its own work per
iteration (the descent, the post, the settle). That is the search's wall time
less what it spent waiting for rewards, divided by the iterations. Here it
is read at `clone4`, against `k0s`'s cost per iteration (first pass, median
over rounds). Beside it, the same bound once `topk:3` makes each iteration
cheaper by that board's V8 ratio (`rollout-policy-cost.md` § 2, 20
iterations: 0.43, 0.54, 0.42, 0.64). The coordinator's own work is assumed
unchanged, since `topk:3` touches only the rollout.

| engine   | `jh7396nx` today / `topk:3` | `jh73x8ad`    | `jh71n516`   | `jh7ba584`   | blade (four positions) |
| -------- | --------------------------- | ------------- | ------------ | ------------ | ---------------------- |
| Chromium | 6.4× / 2.7×                 | 13.1× / 7.1×  | 13.5× / 5.7× | 13.6× / 8.7× | 1.0–1.6×               |
| Firefox  | 5.7× / 2.5×                 | 19.9× / 10.8× | 13.2× / 5.6× | 12.3× / 7.9× | 0.9–1.3×               |
| WebKit   | 5.1× / 2.2×                 | 16.9× / 9.1×  | 12.7× / 5.3× | 15.0× / 9.6× | 0.8–1.6×               |

The V8 profile agrees in kind. There the rollout is 88–96% of an iteration
on these boards (descent 4–11%), a bound of 8–24×; on blade boards it is
35–55%, a bound of 1.5–2.2×.

**Verdict.** At today's policy four helpers sit far under the ceiling on
every field board: at L = 16 the coordinator still waits 71–75% of the
search. The bound is the number of helpers. At `topk:3`, the cheapest policy `rollout-policy-cost.md`
keeps and the one being built (issue #10473), the bound falls by half or
more: 2.2–2.7× on the lightest board, where K = 3 already reaches it, and
5.3–10.8× on the other three. The two levers multiply only up to that
bound: `topk:3` about doubles a field iteration's rate, and helpers buy at
most 2.2–3.1× more on a board like `jh7396nx`. The policy is the lever
that holds on every board and every device; helpers pay on wide boards, on
desktops, in Chromium most.

## 6. Proposal

For the owner to rule before any implementation slice is filed.

- **The batch rule.** § Method's, unchanged: virtual loss of one visit at
  reward 0 for each edge's mover; at most K leaves in flight; the oldest
  settled first; rewards in dispatch order; one u32 seed per world and per
  rollout drawn from the search's stream. A **lag** L of leaves in flight on
  K helpers, the job to the least-loaded helper: **L = 2K**. At four helpers, L = 8 reads 3.1–3.7× on the field boards
  against 2.5–2.9× at L = K, and at Gecko's equal time leaves 7 red against 11. L = 16 adds 0.2–0.5× more and leaves 9.
- **The transport.** `clone`: the world structured-cloned per rollout. It
  costs 0.3–0.8 ms on a field board, needs no root state in the helper and
  no replay to keep in step with the descent. `replay` is not cheaper where
  it matters.
- **The K policy.** `K = min(4, navigator.hardwareConcurrency − 2)`: the
  page and the coordinator each keep a core. K = 0 when
  `navigator.deviceMemory` reports 4 GB or less or the device is mobile:
  a phone runs no helper. And per decision, an **adaptive gate**: the
  coordinator rolls out its first leaves itself, and turns helpers on only
  when the median rollout so far exceeds a threshold. 10 ms is proposed:
  above every blade board, below every field board measured. On a narrow
  board a helper only adds the hop, in Firefox and WebKit 2–8 ms per rollout.
- **The Brain channel.** Today `brain-client.ts` spawns one Worker and
  `brain.worker.ts` serves one consult at a time on a promise chain. Under
  the proposal that Worker becomes the coordinator and spawns its K helpers
  itself: nested dedicated Workers, or ports wired by the page as the bench
  does. Each helper receives every Manifest prime the coordinator receives,
  then a context per search and one job per rollout, and answers with
  `{ reward, margin }`. The prototype blocks on a `SharedArrayBuffer`, which
  needs a cross-origin-isolated page: COOP `same-origin` and COEP on the
  app. COEP `require-corp` would refuse every cross-origin resource that
  does not opt in, the Scryfall card art among them (`cards.scryfall.io`,
  `ambient-backgrounds.ts`). The proposal is therefore an **asynchronous
  coordinator**: the iteration loop of `runSearchWithTrace` is split into
  begin / step / finish, and the coordinator yields to its event loop when K
  leaves are in flight, so rewards arrive through `onmessage`. That is an
  engine change to the loop alone. ADR 0074 holds: the helpers are client
  Brain code with no authority.
- **Determinism and the blade.** As § 4: the blade stays at K = 0, and K is
  a census variant.
- **ADR 0000.** § 1 says "a single information-set tree … on a
  single-threaded, budget-limited client". It would be amended to: one
  information-set tree, in one Worker, whose rollouts may run on helper
  Workers. The single tree, the single statistics and the re-determinization
  per iteration all stand. What changes is that the client is no longer
  single-threaded.
- **Order against issue #10473.** `topk:3` first: it holds on every device
  and halves this design's ceiling. This design after it, measured again
  beside it, and only if the field still falls short of 400 on desktops.

## 7. The owner's ruling

Pending: put to the owner with § 1, § 3 and § 6. No implementation slice
is filed and ADR 0000 is not amended until it is recorded here.

## Not measured

- **What else idles a helper.** At L = 16 a helper is busy 93–94% of a
  field search by its rollout's clock; the rest (delivery, deserialisation,
  between-task collection) was not traced.
- **A starved device.** 8 cores under a load of 15–112: each added Worker
  took a share of a contested CPU, which flatters the scaling. A four-core
  device was not read; this machine cannot confine a browser to fewer cores.
- **The asynchronous coordinator** § 6 proposes. The prototype blocks on a
  `SharedArrayBuffer`; a loop that yields to its event loop between leaves
  receives its rewards through `onmessage`, and that adds one event-loop hop
  per settle. Not built.
- **`topk:3` and helpers together.** § 5's ceiling under `topk:3` is
  computed from that note's V8 per-board ratios, not read with helpers
  running.
- **Field boards beyond four**, and at counts above 285 iterations: the
  hand-off was read on the first 20–30 iterations of a search, the
  probe-densest part.
- **A phone.** No helper was run on one; the proposal gives a phone none.

## Caveats

- **Load.** 14.7–111.7 throughout, on 8 cores: every thread was one of 10–19
  runnable threads per core. There each added Worker takes one more share of
  a contested CPU, which flatters the scaling, as it did in
  `brain-root-parallel-search.md`; a four-core device running four helpers
  beside its page has no such share to take.
- **Playwright's browser builds** are patched builds, not the release
  browsers; WebKit on macOS is not Safari on a phone.
- **The prototype blocks** with `Atomics.wait`, which only a
  cross-origin-isolated page may do; the app is not one today (§ 6).

## Reproduce

From a bootstrapped worktree, with Playwright's three browsers installed and
the four field fixtures pulled by `field-position.mjs` into `$F`:

```bash
D=docs/research/scripts/brain-bench
node $D/run-leaf.mjs build /tmp/leaf.js
node $D/build.mjs /tmp/plain.js

# the checks
node $D/run-leaf.mjs check /tmp/leaf.js /tmp/plain.js /tmp/check.json \
    --positions 0,11,40,54 --iterations 150 --field $F/jh7396nx.json --field-iterations 10

# § 1–2: throughput and the in-browser hand-off
node $D/run-leaf-browsers.mjs /tmp/leaf.js /tmp/browsers.json --positions 0,11,40,54 \
    --field $F/jh7396nx.json --field $F/jh73x8ad.json --field $F/jh71n516.json --field $F/jh7ba584.json \
    --blade-cap 2000 --field-cap 8300 --rounds 3
node $D/summarize-leaf.mjs throughput /tmp/browsers.json

# § 2: the hand-off in V8
node $D/run-leaf.mjs handoff /tmp/leaf.js /tmp/handoff-v8.json --positions 0,11,40,54 \
    --iterations 200 --field $F/jh7396nx.json --field $F/jh73x8ad.json \
    --field $F/jh71n516.json --field $F/jh7ba584.json --field-iterations 30
node $D/summarize-leaf.mjs handoff /tmp/browsers.json /tmp/handoff-v8.json

# § 1 second and third passes (K = 4; the lag)
for ARMS in k0s,clone4,replay4 k0s,clone4,clone4l8,clone4l16; do
  node $D/run-leaf-browsers.mjs /tmp/leaf.js /tmp/browsers-$ARMS.json --positions 0,11,40,54 \
      --field $F/jh7396nx.json --field $F/jh73x8ad.json --field $F/jh71n516.json --field $F/jh7ba584.json \
      --blade-cap 2000 --field-cap 8300 --rounds 3 --arms $ARMS
done

# § 3, quality (each in slices: --slice i/n, then summarize the files together)
node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-decl.jsonl --arms base,k0s,k2,k4 --every 4
node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-b94.jsonl --arms base,k0s,k2,k4 --budget 94
node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-b94k8.jsonl --arms k0s,k8 --budget 94
node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-b236.jsonl --arms base,k0s,k4,k8 --budget 236
for B in 94 236; do
  node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-t$B.jsonl --budget $B \
      --arms k0s,k3@time=1.77,k0@time=1.77,k4@time=1.6,k0@time=1.6
done
for B in 94 236; do
  node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-lag$B.jsonl --budget $B \
      --arms k0s,k16,k8@time=3.09,k0@time=3.09,k16@time=3.31,k0@time=3.31
done
node $D/run-leaf.mjs blade /tmp/leaf.js /tmp/q-census.jsonl --arms base,k0s,k3@time=1.77 --budget 94 --seeds all
node $D/summarize-leaf.mjs quality /tmp/q-b94.jsonl   # and each other file
```
