# The Brain's search off the development machine (issue #9527)

> **Measured at** `90996ede2`, 2026-11-13, on the development MacBook (Apple
> M1 Pro, 8 cores) while it was also the pipeline's runner: load average 22–233
> throughout. **Dated:** every number below is as of that commit and that day.
> Slice 2 of PRD issue #9525.

**Question.** The Brain runs on the player's device at a budget of iterations
capped by wall-clock time (`expert`, the default: 1320 iterations, 3300 ms).
`iterations-per-decision.md` measured it on this machine, in V8, at `medium`
only, and named its own gap: real hardware, other engines, the presets above
`medium`. What does the search do in the other browser engines, on a slower
core, with few cores, beside a second Brain Worker — and where does one
iteration's time go?

**Verdict up front.**

1. **The browser engine is worth a factor of two.** The same bundle, the same
   positions, the same iteration count: Firefox takes **2.0x** Chromium's time
   per iteration (1.8–2.4), WebKit **1.6x** (1.4–2.0). JavaScriptCore under Bun
   agrees with WebKit: 1.3x V8 by CPU time.
2. **A slower device silently plays a shallower Bot.** At `expert`, a device at
   3.2 ms per iteration completes 85% of the iterations asked for and the clock
   ends 24 of 56 searches; at 6.3 ms it completes 60%; at 12.6 ms, 39%; at
   18.9 ms, 27%. Firefox on this very machine measures 3.1 ms per iteration.
3. **Slowness alone never times a Bot consult out.** At no slowdown up to 20x
   does a capped search overrun the 5,000 ms consult timeout: the time cap is
   checked every iteration and the overshoot is one iteration.
4. **A second Brain Worker costs 1–11% when cores are free**, in every engine.
   What it costs on a device with fewer cores than busy threads was **not
   measured** (see § Not measured).
5. **No single hotspot.** Applying moves through the real engine is 32–50% of a
   search, of which state-based actions alone are 21–24%; enumeration 9–19%,
   evaluation 5–22%, cloning 6–15%, garbage collection 4–19%. Every bucket is
   engine code.

## Method

One bundle, every engine. `docs/research/scripts/brain-bench/build.mjs`
bundles the real `searchWithTrace` and the first 60 blade `must` positions
(esbuild, unminified) into a single script; Node, Bun, Chromium, Firefox and
WebKit all run those same bytes, so a difference between two engines is the
engine's. 4 of the 60 positions have one forced move and no search; the tables
count the other 56.

The machine is never idle, so nothing below is a wall-clock time taken at face
value:

- **CPU clock for costs.** Under Node and Bun the bench reads the process CPU
  time, which does not count time spent waiting for a core.
- **A scaled clock for slow devices.** The search reads time only through
  `SearchBudget.now`. A clock that runs K times faster makes the search stop
  by `time` exactly where a device K times slower would. Each preset's real
  budget (iterations and time cap) is run at K = 1, 2, 4, 6, 10, 20 on the
  scaled CPU clock.
- **Interleaved ratios in browsers.** A browser has only a wall clock, so the
  three engines search the same position back to back within a round (the
  order rotates), and the result is the per-position ratio to Chromium over
  three measured rounds after a warm-up. Load that drifts over minutes cancels
  out of a ratio.
- **A sampled profile.** A V8 CPU profile (500 µs) of the bundle searching one
  position; only samples under `searchWithTrace` count, each attributed to the
  innermost of five bucket functions on its stack. A preempted thread is
  sampled where it stood, so the shares hold under load.

Every search uses the blade seed (`0xb1ade`) and the position's own deck
knowledge. One run per cell: there is no repeat-run variance figure.

## Results

### 1. Engines

Browsers through Playwright 1.62.1 (Chromium 151.0.7922.34, Firefox 153.0,
WebKit 26.5), 12 positions spread from cheap to expensive, 400 iterations, no
time cap, on the page's main thread. Load average during the rounds: 22–33.

| engine   | ms per iteration, median | ratio to Chromium, p10 | median | p90  |
| -------- | ------------------------ | ---------------------- | ------ | ---- |
| Chromium | 1.60                     | 1.00                   | 1.00   | 1.00 |
| Firefox  | 3.11                     | 1.76                   | 1.98   | 2.39 |
| WebKit   | 2.62                     | 1.41                   | 1.62   | 2.00 |

The same bundle under a CPU clock, 56 positions at 1320 iterations: Bun 1.3.9
(JavaScriptCore) against Node 24.21.0 (V8 13.6), time per iteration.

| ratio, JavaScriptCore / V8 | p10  | median | p90  |
| -------------------------- | ---- | ------ | ---- |
| CPU time (all threads)     | 1.13 | 1.34   | 1.60 |
| wall time                  | 0.82 | 1.42   | 2.71 |

**Verdict: the engine matters as much as a hardware generation.** Firefox is
about twice as slow as Chromium on this workload and WebKit about 1.6 times;
the JavaScriptCore figure from Bun corroborates WebKit's with a clock the
browser run does not have.

### 2. Slow cores

Node (V8), CPU clock, load average 59–233. What one decision costs at
`expert`'s 1320 iterations with no time cap:

|                   | p10  | median | p90  | max   |
| ----------------- | ---- | ------ | ---- | ----- |
| search, ms        | 1204 | 3648   | 8068 | 23910 |
| per iteration, ms | 1.18 | 3.15   | 6.11 | 18.11 |

21 of 56 searches stop early as `settled`. 31 of 56 need more than `expert`'s
3300 ms on this core.

The K = 1 row is **this machine under that load**, not an idle performance
core: CPU time counts the same whether the thread ran on a performance core or
an efficiency core, and under this load it ran on both. The second column
turns K into the device's median time per iteration, which is the number the
field report of issue #9526 carries (`msPerIteration.p50`), so a real game can
be read straight off these tables.

`expert` (1320 iterations, 3300 ms):

| K   | device ms per iteration | stopped by time | iterations completed, all searches | median search completes | worst search completes | past the 5,000 ms consult timeout |
| --- | ----------------------- | --------------- | ---------------------------------- | ----------------------- | ---------------------- | --------------------------------- |
| 1x  | 3.2                     | 24 / 56         | 85%                                | 100%                    | 22%                    | 0 / 56                            |
| 2x  | 6.3                     | 43 / 56         | 60%                                | 57%                     | 12%                    | 0 / 56                            |
| 4x  | 12.6                    | 52 / 56         | 39%                                | 32%                     | 6%                     | 0 / 56                            |
| 6x  | 18.9                    | 54 / 56         | 27%                                | 23%                     | 4%                     | 0 / 56                            |
| 10x | 31.5                    | 56 / 56         | 17%                                | 15%                     | 2%                     | 0 / 56                            |
| 20x | 63.1                    | 56 / 56         | 9%                                 | 9%                      | 1%                     | 0 / 56                            |

`medium` (400 iterations, 1500 ms):

| K   | device ms per iteration | stopped by time | iterations completed, all searches | median search completes | worst search completes | past the 5,000 ms consult timeout |
| --- | ----------------------- | --------------- | ---------------------------------- | ----------------------- | ---------------------- | --------------------------------- |
| 1x  | 3.2                     | 11 / 56         | 85%                                | 90%                     | 31%                    | 0 / 56                            |
| 2x  | 6.3                     | 38 / 56         | 68%                                | 67%                     | 14%                    | 0 / 56                            |
| 4x  | 12.6                    | 51 / 56         | 46%                                | 42%                     | 8%                     | 0 / 56                            |
| 6x  | 18.9                    | 54 / 56         | 35%                                | 32%                     | 5%                     | 0 / 56                            |
| 10x | 31.5                    | 54 / 56         | 22%                                | 20%                     | 3%                     | 0 / 56                            |
| 20x | 63.1                    | 56 / 56         | 12%                                | 11%                     | 2%                     | 0 / 56                            |

"Completed" is against what the search would have run with no time cap: its
own iteration count when it settles early, the preset's otherwise.

The same sweep under Bun (JavaScriptCore, K = 1 at 4.2 ms per iteration) gives
`expert` 76% at 1x, 49% at 2x, 24% at 4x, 19% at 6x.

**Verdict: the time cap makes the Bot's depth a property of the device.**
Already at 3.2 ms per iteration the clock ends 24 of 56 `expert` searches, and
the costliest positions get a fifth of their budget. Past ~6 ms per iteration
the typical decision runs on about half the iterations the blade suite proves
the Bot at; past ~12 ms, on a third. Nothing fails on the way down: no
timeout, no error, a weaker move.

For scale: Chromium on this machine measures 1.6 ms per iteration (§ 1, a
different position sample and iteration count), Firefox 3.1 ms — Firefox on an
M1 Pro already sits on the first row.

### 3. The game-end judge, read off the same data

The judge of issue #9514 searched 400 iterations with **no** time cap behind a
5,000 ms consult timeout. Estimated from each position's cost per iteration
(§ 2), the share of 400-iteration searches that outlast that timeout:

| device, relative to § 2's K = 1 | median search, ms | longer than 5,000 ms |
| ------------------------------- | ----------------- | -------------------- |
| 1x                              | 1262              | 2 / 56               |
| 2x                              | 2499              | 5 / 56               |
| 3x                              | 3786              | 13 / 56              |
| 4x                              | 5048              | 29 / 56              |
| 6x                              | 7571              | 41 / 56              |

**Verdict: the field's judge timeouts need no exotic cause.** A device two to
four times slower than this row — Firefox on an older laptop — times out a
tenth to a half of the judge's searches on its own, before the shared-Worker
queue of issue #9514 multiplied them.

### 4. Two Workers

In each browser: a Brain Worker searching one of the three most expensive
sampled positions alone, against the same search while a second Brain Worker
runs an uncapped search beside it. 18 alternated pairs per engine; load
average 29–61.

| engine   | slowdown, p10 | median | p90  |
| -------- | ------------- | ------ | ---- |
| Chromium | 0.95          | 1.01   | 1.10 |
| Firefox  | 0.98          | 1.07   | 1.15 |
| WebKit   | 1.05          | 1.11   | 1.26 |

**Verdict: with cores to spare a second Worker is nearly free** — 1% to 11%
at the median. That is the regime of this machine, not of a two-core device.

### 5. Where a search's time goes

V8 CPU profile, 1320 iterations, three positions: the cheapest searched one,
the median one and the most expensive one of § 2.

| position                                                        | iterations | search ms | clone | determinize | enumerate | apply | evaluate | gc    | other |
| --------------------------------------------------------------- | ---------- | --------- | ----- | ----------- | --------- | ----- | -------- | ----- | ----- |
| melee: swings for the lethal only the pump provides             | 700        | 720       | 9.9%  | 0.5%        | 14.2%     | 33.4% | 5.0%     | 18.6% | 18.5% |
| as-enters name: casts Meddling Mage on an empty board           | 1320       | 3556      | 5.8%  | 0.5%        | 11.2%     | 50.0% | 8.1%     | 9.1%  | 15.3% |
| discriminating pair: attacks with a counter-bodied Walking B... | 1320       | 16915     | 14.9% | 0.1%        | 9.0%      | 32.1% | 22.3%    | 4.2%  | 17.3% |

The buckets partition the search: a clone made while enumerating is cloning.
`apply` is a move through the real engine (resolution, state-based actions,
triggers, layers); `gc` is the whole run's collection; `other` is the search
loop and everything unnamed.

Inclusive shares of named engine functions (they overlap each other and the
buckets):

| function                 | cheapest | median | most expensive |
| ------------------------ | -------- | ------ | -------------- |
| `applyMoveInSearch`      | 33.4%    | 50.0%  | 32.1%          |
| `checkStateBasedActions` | 21.0%    | 24.2%  | 21.8%          |
| `enumerateMoves`         | 19.1%    | 11.2%  | 9.5%           |
| `evaluate`               | 5.0%     | 8.1%   | 22.3%          |
| `cloneValue`             | 9.6%     | 5.5%   | 14.6%          |
| `deriveBoardWithSources` | 4.7%     | 3.7%   | 2.5%           |
| `collectTriggers`        | 3.8%     | 4.4%   | 4.0%           |
| `determinize`            | 2.6%     | 1.3%   | 0.3%           |

The largest self-time entry anywhere is `cloneValue` (5.5–14.6%); no other
named function exceeds 4%.

**Verdict: the cost is the rules engine run thousands of times, spread thin.**
Two things follow for the options the PRD weighs.

- _Optimising in place._ The one named piece worth a project is
  `checkStateBasedActions`: a fifth to a quarter of every search, run after
  each applied move over the whole board. Cloning plus collection is 15–29% —
  allocation, the second target. No other function is worth more than a few
  percent, so in-place work has a ceiling well short of an order of magnitude.
- _An engine rewrite._ Every bucket is engine code, so a faster language buys
  speed only by porting the engine itself: resolution, state-based actions,
  triggers, layers, enumeration, evaluation. The allocation share is what a
  compact-memory representation removes almost outright; the rest is the same
  logic running faster. This profile cannot say by how much — it says there
  is no small piece to port.

## Not measured

- **Few cores.** The bench tried to confine each browser to the two efficiency
  cores with `taskpolicy -b`. Chromium and Firefox did not start under it
  (their control pipe did not survive the wrapper; launch timed out at 180 s),
  and WebKit started but was not confined (2.24 ms per iteration against 2.45
  unconfined: its content process is not a child of the launcher). The option
  was removed from the script. A container with a CPU quota, or a hosted
  two-core runner, would measure it; this machine cannot.
- **A second Worker on a starved device.** § 4 holds only while cores are
  free. With fewer cores than busy threads the two Workers and the page's own
  thread share them, and the Bot's search slows in proportion; that proportion
  was not measured. It stops mattering if the judge leaves the device (issue
  #9528), since the judge is the only second Brain Worker there is.
- **Phones, and any machine but this one.** One laptop. The scaled clock says
  what a slower core does to the search, not how slow any real device is: that
  is the field report's job (issue #9526).
- **An idle baseline.** No run saw a load average under 22.

## Caveats

- **Load.** CPU time removes the wait for a core, not the slowdown of running
  on an efficiency core or with a cold cache. The 2026-09-29 idle re-measure in
  `iterations-per-decision.md` put a `medium` decision at 583 ms of CPU at the
  median on an earlier version of this position set; the same quantity
  estimated here is 1262 ms. Read § 2's K = 1 as roughly twice an idle
  performance core, and the "device ms per iteration" column as the anchor.
- **Playwright's browser builds.** Its Firefox and WebKit are patched builds,
  not the release browsers; WebKit on macOS is not Safari on a phone.
- **The positions are small.** Blade `must` entries are hand-built boards with
  a clear answer. A late turn of a real game has more permanents and more legal
  moves, and a costlier iteration.
- **The profile is V8's.** The shares in another engine may differ.
- **An earlier browser run used a bundle built with esbuild's `keepNames`.**
  Its `__name` helper took 5–7% of a search in the profile and 4% of V8's CPU
  time (median of 15 paired searches, 1.02–1.17), and it weighed on Firefox
  far more: that run, at load 154–233, read Firefox at 2.67x Chromium and
  WebKit at 1.45x. § 1 and § 4 are from the helper-free bundle; § 2 and § 3
  are from the earlier one, so their absolute times are about 4% high.

## Reproduce

From a bootstrapped worktree, with Playwright's three browsers installed
(`bunx playwright install chromium firefox webkit`):

```bash
B=/tmp/brain-bench.js
node docs/research/scripts/brain-bench/build.mjs $B

# § 2, § 3 and the JavaScriptCore half of § 1 (CPU clock; ~1 h each under load)
node docs/research/scripts/brain-bench/run-engines.mjs $B /tmp/v8.json
bun  docs/research/scripts/brain-bench/run-engines.mjs $B /tmp/jsc.json
node docs/research/scripts/brain-bench/summarize.mjs engines /tmp/v8.json /tmp/jsc.json

# § 1 and § 4
node docs/research/scripts/brain-bench/run-browsers.mjs $B /tmp/browsers.json
node docs/research/scripts/brain-bench/summarize.mjs browsers /tmp/browsers.json

# § 5 — position indexes: cheapest, median and most expensive of v8.json's `cost`
node docs/research/scripts/brain-bench/profile.mjs $B /tmp/profile.json 45 18 35
node docs/research/scripts/brain-bench/summarize.mjs profile /tmp/profile.json
```

`entry.mjs` is the payload: it exposes `globalThis.__brainBench.run(index,
{ iterations, timeMs, clock, scale, seed })`.
