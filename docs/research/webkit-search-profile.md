# Where WebKit's search time goes, and what closes its 1.3x (issue #10123)

> **Measured at** `a77721f18`, 2026-11-18, on the MacBook runner (Apple M1
> Pro, 8 cores, macOS 26.6.2, on mains power), with the other runners busy:
> load average 10–13 throughout. **Dated:** every number below is as of that
> commit and that day. Engines: Bun 1.3.9 (JavaScriptCore, WebKit
> `0ddf6f47af0a`) and Node v24.21.0 (V8 13.6.233.17) on the same bundle;
> Playwright 1.62.1's Chromium 151.0.7922.34 and WebKit 26.5. Slice of PRD
> issue #10017.

**Question.** The owner's ruling (`expert-think-longer.md` § 5) asks `expert`
for 400 iterations on every engine family, which within 5 s means **≤ 12.5 ms
per iteration**. WebKit spends 16.5 ms in the field, so it needs a **1.3x**
speed-up. Its field gap to Chromium (~1.6x) matches the lab's
(`brain-search-off-the-dev-machine.md` § 1), so the question is not an anomaly
but JavaScriptCore's own profile, which no one had taken: only V8 was
profiled. Where does a JSC search's time go, what does JSC pay more for than
V8, and what would win the 1.3x back?

**Verdict up front.**

1. **JavaScriptCore spends a search where V8 does.** On the same positions,
   the same seed and the same search tree, the buckets agree within the
   run-to-run noise: applying moves 29–60%, evaluation 11–27%, enumeration
   5–16%, cloning 3–12%. The longer a search, the more of it runs in FTL,
   JSC's top tier (26–28% on short searches, 52–57% on long ones). GC pauses
   take 3–4% of the wall time.
2. **What JSC pays more for is trigger collection.**
   `effectiveTriggeredAbilities` costs JSC 2.2–3.7x what it costs V8,
   against 1.2–1.4x for the search as a whole, on every position, in both
   runs. Getting back to the search's own ratio would win 2.4–5.3% of a JSC
   search. Below it, the collectors that call it, the mana census's per-unit
   `Set` (on the mana-heavy board), and `cloneValue` (on the long searches)
   add 1–3% each. C++ built-ins (`Set`, `Map`, `includes`, `join`, object
   spread) are 8–11% of a JSC search's self time, spread over dozens of
   callers.
3. **None of it reaches 1.3x.** Every hotspot together buys WebKit about a
   tenth (16.5 → about 15 ms per iteration). The 1.3x is the same engine-wide
   work as Gecko's (`gecko-search-gap.md`): evaluation, the sweep after every
   applied move (`checkStateBasedActions` 18–29%), and cloning, on
   field-sized boards.
4. **Real WebKit is behind JSC under Bun, on cheap boards.** Playwright's
   WebKit runs at **1.54x** Chromium on cheap blade boards and **1.2–1.3x** on
   costly ones (blade 35 and the field board). JSC under Bun runs at 1.2–1.4x
   V8 on the same positions under its profiler. The size dependence is
   WebKit's, not the engine code's: a per-search cost, as yet unattributed.

## Method

The lab bench (`docs/research/scripts/brain-bench/`): one esbuild bundle of the
real `searchWithTrace` that every engine runs unchanged. This note adds two
scripts and extends three:

- **`profile-jsc.mjs`** (under `bun`) — JSC's own sampling profiler through
  `bun:jsc`'s `profile()`, one cold `bun` per position, folded into the SAME
  buckets as `profile.mjs` (`buckets.mjs`). Every sampled stack comes back with
  each frame's JIT tier. JSC takes one sample about every millisecond at a
  100 µs request: it suspends the thread to walk the stack. Every sample weighs
  the same, as in JSC's own reports, and only the frames under the outermost
  `searchWithTrace` count. GC comes from the child's `BUN_JSC_logGC=1` log:
  JSC collects concurrently, and the pauses it logs (`p=`) are the time the JS
  thread was stopped.
- **`jsc-excess.mjs`** — a V8 and a JSC profile of the same positions, compared
  function by function. Both engines search the SAME tree (same bundle, same
  seed, and the script checks that the chosen move agrees), so a function's time
  in one engine against the other is like for like. It reads **inclusive**
  time, never self: V8 charges an inlined built-in (`filter`, `map`, spread) to
  its caller, JSC to a frame of its own. A function's **share** is its
  inclusive time over its engine's `searchWithTrace`. Its **excess** is JSC's
  share minus V8's: what JSC would win back if it ran that function no worse,
  relative to V8, than it runs the search as a whole.
- `profile.mjs` and `profile-jsc.mjs` both write `inclusiveAll`, every
  function's inclusive share at 0.5% or more (`buckets.mjs`).
- `run-gecko-gap.mjs` takes `--browsers webkit`: Chromium against Playwright's
  WebKit, main thread and Worker, interleaved rounds (unchanged otherwise).

**Why not `bun --cpu-prof`.** Bun 1.3.9 writes a Chrome `.cpuprofile`, but
it keeps one sample every ~4 ms at a 500 µs request. Each sample is weighted
by the gap to the previous one (up to 200 ms), so a handful of samples carries
most of the time. `profile()` returns every stack JSC took.

**Positions.** Blade: `must` entries 45, 18 and 35 (the Gecko note's,
`gecko-search-gap.md`): a combat board, a land-face board, and the costly
Walking Ballista board. Field: `jh77ktxx` seq 41, a production game at turn
3 with 4 permanents, at its final row, made searchable by `runField`. **The
field note's two WebKit games (`jh74q517`, `jh7bkzta`) are gone from
production.** Of the three games it still stores, this is the only real
played board: `jh7a571m` is a seeded 83-permanent board at 3.1 s per
iteration, nothing a player reaches. Every position at **400 iterations**,
the ruling's target.

**Load.** The runner was at load 10–13 on 8 cores. The shares are sampled and
hold under load (a preempted thread is sampled where it stood). The wall
times and the ratios between them move with it, which is why § 3 reads each
position's ratio inside one run, and § 2's ratios come from interleaved rounds.

## Results

### 1. Bucket shares, V8 beside JavaScriptCore

Each bucket's share of the search. V8: `profile.mjs`, its `gc` taken out
(V8 reports the whole process's collection outside every stack, 3–16% here)
and the rest re-based to 100, so the two rows compare. JSC: `profile-jsc.mjs`,
which has no `gc` bucket (§ 4). Search ms is the wall time under the profiler.

| position                                     | engine | search ms | clone | determinize | enumerate | apply | evaluate | other |
| -------------------------------------------- | ------ | --------- | ----- | ----------- | --------- | ----- | -------- | ----- |
| blade 45: flanking pair, vanilla 2/2 blocked | V8     | 693       | 8.4   | 0.7         | 5.3       | 55.9  | 15.4     | 14.3  |
|                                              | JSC    | 953       | 6.7   | 0.8         | 7.3       | 60.1  | 10.9     | 14.1  |
| blade 18: mdfc plays the land face           | V8     | 691       | 6.4   | 0.2         | 8.8       | 48.8  | 10.9     | 24.8  |
|                                              | JSC    | 826       | 2.9   | 1.0         | 13.1      | 49.5  | 11.0     | 22.4  |
| blade 35: no Walking Ballista attack         | V8     | 3385      | 12.0  | 0.0         | 9.8       | 35.2  | 23.1     | 19.9  |
|                                              | JSC    | 4169      | 12.4  | 0.2         | 10.4      | 32.5  | 24.2     | 20.3  |
| field `jh77ktxx` seq 41 (4 permanents)       | V8     | 4956      | 8.7   | 0.5         | 13.3      | 32.3  | 26.6     | 18.6  |
|                                              | JSC    | 5906      | 11.7  | 0.5         | 15.6      | 29.4  | 23.8     | 19.0  |

`checkStateBasedActions`, inclusive: 19.5–25.0% in V8 (re-based), 18.2–29.2%
in JSC.

**Run-to-run noise.** The two short searches (blade 45 and 18, 600–950 JSC
samples) move by up to 6 points between runs: blade 18's clone read 11.4,
5.1 and 5.4 in three V8 runs (raw shares), and 3.6, 6.3 and 2.9 in three JSC
runs. The long
searches (4000–6000 samples) hold within 1–2 points.

JSC's JIT tiers, share of search samples (the innermost frame's tier; `host`
is a C++ built-in):

| position         | LLInt | Baseline | DFG  | FTL  | host |
| ---------------- | ----- | -------- | ---- | ---- | ---- |
| blade 45         | 0.3   | 27.8     | 35.6 | 27.7 | 8.6  |
| blade 18         | 0.8   | 21.7     | 40.7 | 25.9 | 11.0 |
| blade 35         | 0.5   | 11.0     | 20.7 | 57.3 | 10.5 |
| field `jh77ktxx` | 0.4   | 13.1     | 25.6 | 51.5 | 9.4  |

**Verdict: the same engine code costs the same share in both engines.** No
bucket is a JSC outlier beyond the noise; on the long searches every bucket
agrees within 3 points. A cold sub-second search spends a quarter of its time
in Baseline, JSC's first JIT tier, and a long one half in FTL.

### 2. WebKit against Chromium

`run-gecko-gap.mjs --browsers webkit`, 3 measured rounds after a warm-up, 400
iterations everywhere; load 9–12. Milliseconds per iteration are the median
over positions and rounds. The ratio is each search's time over Chromium's on
the main thread at the same position and round (median, then the range).

| boards             | thread | browser      | ms per iteration | ratio to Chromium, main | range       |
| ------------------ | ------ | ------------ | ---------------- | ----------------------- | ----------- |
| blade (45, 18, 35) | main   | Chromium 151 | 0.84             | 1.00                    | —           |
|                    | main   | WebKit 26.5  | 1.37             | 1.54                    | 1.20 – 1.71 |
|                    | worker | Chromium 151 | 0.99             | 1.05                    | 0.92 – 1.19 |
|                    | worker | WebKit 26.5  | 1.34             | 1.58                    | 1.18 – 1.68 |
| field `jh77ktxx`   | main   | Chromium 151 | 7.32             | 1.00                    | —           |
|                    | main   | WebKit 26.5  | 8.85             | 1.25                    | 1.13 – 1.33 |
|                    | worker | Chromium 151 | 7.81             | 1.09                    | 1.07 – 1.09 |
|                    | worker | WebKit 26.5  | 9.18             | 1.32                    | 1.17 – 1.38 |

Per position, WebKit over Chromium on the same thread: blade 45 1.36–1.71,
blade 18 1.35–1.73, blade 35 **1.00–1.25**, field **1.07–1.33**.

**Verdict: WebKit's distance shrinks as the board grows.** On boards that
cost 6–8 ms per iteration it is 1.2–1.3x; on sub-millisecond ones 1.5–1.7x,
the lab's 1.6x. A Worker costs WebKit nothing it does not cost Chromium. The
size dependence is not in the engine code (§ 1 and § 3 find no bucket that
grows with it), so it is a per-search or per-iteration overhead of WebKit's
own. This note does not attribute it.

### 3. What JavaScriptCore pays more for

`jsc-excess.mjs` over § 1's profiles. Search-wide, JSC's wall time under its
profiler was 1.37x V8's (blade 45), 1.20x (18), 1.23x (35) and 1.19x
(field). The functions whose time grew most beyond that, and their reading on
every position:

| function (inclusive)                                   | JSC / V8 time, blade 45 · 18 · 35 · field | excess, % of a JSC search |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------- |
| `effectiveTriggeredAbilities`                          | 3.69 · 3.34 · 2.73 · 2.59                 | 3.8 · 4.5 · 5.3 · 2.4     |
| `collectTriggers` (calls the row above)                | 1.64 · 4.56 · 2.38 · 1.69                 | 1.0 · 3.7 · 2.6 · 1.2     |
| `collectStateTriggers` (calls it too)                  | 1.66 · 1.60 · 2.52 · 3.33                 | 0.6 · 1.2 · 2.8 · 1.7     |
| `liveKeywordTriggerInstances` (`flatMap`)              | 2.57 · 1.80 · 2.17 · 2.23                 | 1.0 · 0.9 · 2.9 · 1.3     |
| `dedupByProducedMana` (per-call `Set`, string keys)    | 0.74 · 0.80 · 2.74 · 2.05                 | −0.6 · −1.0 · 2.6 · 0.7   |
| `getManaTapOptionsDetailed`                            | 1.14 · 1.09 · 1.43 · 1.21                 | −0.8 · −0.5 · 1.6 · 0.1   |
| `cloneValue`                                           | 1.10 · 0.54 · 1.31 · 1.69                 | −1.7 · −3.5 · 0.8 · 3.4   |
| `withGraveyardArrivalBatch` (the sweep's zone batches) | 2.32 · 1.72 · 0.91 · 1.09                 | 5.0 · 2.3 · −3.5 · −0.8   |

An earlier run of the same positions (load 13) read `effectiveTriggeredAbilities`
at 2.2–3.4x and 1.7–3.7% excess on blade 45, 35 and the field, and `cloneValue`
at 1.5–1.6x and 1.3–1.8% on blade 35 and the field. The short searches'
excesses swing by ±3–5 points between runs (blade 18's `cloneValue`,
`withGraveyardArrivalBatch` on blade 45 against 35), so only a function that
stands out on the long searches as well is read as a hotspot.

JSC self time V8 has no frame for (C++ built-ins and the JS-implemented array
methods, which V8 inlines into their callers):

| built-in                          | blade 45 | blade 18 | blade 35 | field |
| --------------------------------- | -------- | -------- | -------- | ----- |
| `filter`                          | 1.8      | 2.0      | 3.7      | 2.6   |
| `map`                             | 1.6      | 1.8      | 2.6      | 1.4   |
| `Set` (constructor)               | 1.4      | < 1.0    | 1.8      | 1.3   |
| `join`                            | < 1.0    | 1.3      | 2.2      | < 1.0 |
| `copyDataProperties` (`{...obj}`) | < 1.0    | < 1.0    | < 1.0    | 1.2   |

No named caller of `filter` or `map` holds more than 0.6% of a search. The `Set`
constructor's are the mana census (`manaAvailability.ts`, one `Set<Color>`
per mana unit), `dedupByProducedMana`, and `liveSupertypesOf` /
`copiableSupertypesOf`. `join` is `manaCostKey` under
`dedupByProducedMana`, and object spread is `cardValue` and
`makeLatentBoardLens`, the same callers as in Gecko.

**Verdict: one JSC hotspot stands out, trigger collection, and it is
small.** `effectiveTriggeredAbilities` allocates arrays on every call, two
spreads into `granted` and then `[...base, ...granted]`, for every permanent
at every trigger scan, even when nothing is granted. JSC pays that 2.2–3.7x
what V8 does. The rest is 1–3% each and noisy.

**A caveat on JSC's stacks.** JSC's sampler does not show some frames V8
shows: `cloneGameState` (a one-line wrapper over `cloneValue`) never appears,
and `policyValue` reads 11–14% inclusive against V8's 32–37%. The bundle is
not strict mode, so these are not tail calls; an inlined function is
sometimes reported as its caller. A missing frame makes a function read
LOW in JSC, never high, so the excess table can miss a hotspot but not invent
one. The buckets are safe: each matches `cloneValue` and `applyMoveInSearch`,
which do appear.

### 4. GC and the other threads

| position         | JSC GC pauses, ms (eden / full collections) | share of wall | V8 `gc` (whole process) |
| ---------------- | ------------------------------------------- | ------------- | ----------------------- |
| blade 45         | 34.6 (12 / 1)                               | 3.6%          | 15.1%                   |
| blade 18         | 26.1 (12 / 1)                               | 3.2%          | 16.2%                   |
| blade 35         | 175.3 (74 / 1)                              | 4.2%          | 5.3%                    |
| field `jh77ktxx` | 190.6 (60 / 1)                              | 3.2%          | 3.3%                    |

JSC's pauses cover the whole process, bundle loading included, as V8's do.
The short searches' V8 figure is mostly loading the 10.7 MB bundle; on the long
ones the two engines collect alike. **GC is not where JSC loses.**

The process's CPU time is 1.7–2.6x the search's wall time under JSC and
1.4–1.9x under V8. Both engines compile and collect on other threads, JSC
more so. So the lab's "JavaScriptCore at 1.3x V8 by CPU time"
(`brain-search-off-the-dev-machine.md` § 1) counts JSC's compiler and
collector threads as search time. It is a ratio of process CPU, not of the
time a search takes on its own thread.

## The 1.3x, attributed

| candidate                                  | reading                                                                                                    | verdict                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------- |
| a bucket JSC runs worse                    | every bucket within noise of V8's share; long searches within 3 points                                     | ruled out                    |
| trigger collection                         | `effectiveTriggeredAbilities` 2.2–3.7x V8 against the search's 1.2–1.4x, every position, both runs         | 2–5%: issue #10151           |
| per-unit `Set` in the mana census          | `Set` constructor 1.3–1.8% self; the census callers 1.4–2.7x on the mana-heavy blade 35, near 1x elsewhere | 0–3%: issue #10152           |
| `cloneValue`'s key loop (V8-tuned, #10026) | 1.3–1.7x on the long searches, 0.8–3.4% excess                                                             | 1–3%: issue #10153           |
| object spread, `flatMap`                   | `copyDataProperties` ≤ 1.2%, `liveKeywordTriggerInstances` 1.8–2.6x                                        | 1–2%: issue #10127 (Gecko's) |
| GC                                         | 3.2–4.2% of wall, V8 alike on long searches                                                                | ruled out                    |
| a deopt storm, the interpreter             | LLInt ≤ 0.8%; the long searches 52–57% in FTL                                                              | ruled out                    |
| WebKit's per-search overhead               | WebKit 1.5–1.7x Chromium on cheap boards, 1.2–1.3x on costly ones; no engine bucket follows board size     | not attributed               |

## Slices filed

Under PRD issue #10017, each against the 12.5 ms per iteration target (WebKit
at 16.5 ms in the field). Each is read with `profile-jsc.mjs` before and after
on blade 45, 18, 35 and a field fixture, and with `compare.mjs` against its base
for V8 and the moves:

| issue        | hotspot                                                                                                           | expected on WebKit                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| issue #10151 | trigger collection: `effectiveTriggeredAbilities`' per-call array spreads, the collectors around it               | 2–5%: 16.5 → about 15.9 ms per iteration |
| issue #10152 | the mana census's per-unit `Set<Color>` and `dedupByProducedMana`'s per-call `Set`                                | 0–3%: to about 16.2 ms at best           |
| issue #10153 | `cloneValue`'s key enumeration, chosen on V8 (`Object.keys`; its comment records JSC prefers `for…in`)            | 1–3%: about 16.2 ms                      |
| issue #10127 | (Gecko's slice, JSC reading added) object spread in `cardValue` and the lenses, `flatMap` in the keyword triggers | 1–2%                                     |

Together they buy WebKit 5–12%: about 16.5 → 15 ms per iteration, short of
12.5. The 1.3x is the engine-wide work on field-sized boards that issue
#10097 and the PRD's other engine slices own: evaluation (23–27% on the long
searches), the sweep after every applied move (`checkStateBasedActions`
18–29%), and cloning (11–12%).

## The phone, left open

The field's WebKit row is one iPhone game and one Mac game
(`brain-search-in-the-field.md` § 4), and this note measures neither: one Mac,
JSC under Bun and Playwright's WebKit. A phone's reading belongs to issue
#10116 (the Bot on a weak client) and issue #10028 (the field reading after
the engine changes), now that issue #10022 counts phones. The owner's route
to a release-Safari profile is Safari's Web Inspector (Timelines → JavaScript
& Events) on a vs-Bot game. Its samples are JSC's sampler, the one
`profile-jsc.mjs` reads.

## Not measured

- **The field's own WebKit games.** Production no longer stores `jh74q517` or
  `jh7bkzta`. The one field board here is a small turn-3 board (4
  permanents), 7–9 ms per iteration, not the 14–16 permanent late games the
  field's 16.5 ms comes from.
- **Release Safari.** Playwright's WebKit is a patched build. Safari can be
  driven only through `safaridriver`, which needs the owner to enable remote
  automation.
- **An idle machine.** Load 10–13 throughout; the ratios are within-run.
- **Why WebKit's distance depends on board size** (§ 2). A per-search setup
  cost, the Worker message path, or tier-up thresholds are all candidates.
  None was isolated.

## Reproduce

From a bootstrapped worktree, with Bun, and with Playwright's browsers
(`bunx playwright install chromium webkit`):

```bash
B=/tmp/brain-bench.js
node docs/research/scripts/brain-bench/build.mjs $B

# A field fixture — production, read-only; run against the checkout whose
# Convex project is production. Keep the file out of the repository.
node docs/research/scripts/brain-bench/field-position.mjs jh77ktxx /tmp/field-jh77ktxx.json --cwd <primary checkout>
F=/tmp/field-jh77ktxx.json

# § 1 and § 4 — V8 and JSC profiles, the same positions
node docs/research/scripts/brain-bench/profile.mjs     $B /tmp/v8.json  --iterations 400 45 18 35 $F
bun  docs/research/scripts/brain-bench/profile-jsc.mjs $B /tmp/jsc.json --iterations 400 45 18 35 $F

# § 3 — what JSC pays more for (the table's rows: --min 0.5 --top 400)
node docs/research/scripts/brain-bench/jsc-excess.mjs /tmp/v8.json /tmp/jsc.json --min 0.5 --top 400

# § 2 — WebKit against Chromium
node docs/research/scripts/brain-bench/run-gecko-gap.mjs $B /tmp/gap.json --browsers webkit --rounds 3 --field-iterations 400 45 18 35 $F
```

Each profile JSON carries per-position `shares`, `inclusive`, `inclusiveAll`
and `topSelf`; JSC's adds `tiers`, `samples` and `gc`. A slice's WebKit reading
is `profile-jsc.mjs` before and after, then `jsc-excess.mjs` against a V8
profile of the same head.
