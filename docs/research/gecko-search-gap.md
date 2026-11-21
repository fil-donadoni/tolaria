# Why Gecko searches slower than Chromium in the field (issue #10122)

> **Measured at** `147e00b5c`, 2026-11-17, on the Huawei runner (Intel Core
> i7-8550U, 4 cores / 8 threads, Linux, on mains power, load average 2–4)
> while it ran this pass only. **Dated:** every number below is as of that
> commit and that day. Browsers: Playwright 1.62.1's Chromium 151.0.7922.34 and
> Firefox 153.0, and a release Firefox 160.0.1 (Mozilla's Linux build, driven
> through WebDriver BiDi). Node v24.21.0 (V8 13.6). Slice of PRD issue #10017.

**Question.** The field (`brain-search-in-the-field.md` § 1) read Gecko at
**4.4x** Chromium's time per iteration; the lab
(`brain-search-off-the-dev-machine.md` § 1) at **2.0x**. The owner's ruling
(`expert-think-longer.md` § 5) asks `expert` for 400 iterations on every
engine family, which within 5 s means **≤ 12.5 ms per iteration**: Gecko
spends 46 ms in the field. Where does a Gecko search's time go, is it where
V8's goes, and what makes 2.0x into 4.4x?

**Verdict up front.**

1. **SpiderMonkey spends a search where V8 does.** On the same positions the
   two profiles' buckets agree within a few points: applying moves 30–56%
   (state-based actions alone 21–28%), evaluation 11–34%, enumeration 6–12%,
   cloning 3–13%, collection 1–4%. 67–85% of Gecko's search time runs in Ion,
   its optimising tier: no deoptimisation storm.
2. **One Gecko-only hotspot, and it is small.** SpiderMonkey's self-hosted
   iterator `next` — the `for…of` protocol V8 inlines away — takes 4–8% of
   every search, spread over dozens of callers. Object spread
   (`CopyDataPropertiesUnfiltered`) and `flatMap` (`FlattenIntoArray`) add
   1–3% each. Removing all of them buys Gecko about a tenth: nowhere near the
   3.7x the ruling needs.
3. **The 2.0x → 4.4x gap is not the engine's.** On this machine Firefox
   runs at **0.96–1.19x** Chromium on blade boards and **1.30–1.37x** on
   field-sized ones. A DOM Worker does not widen it, and neither does the release
   browser against Playwright's build. Board size widens Gecko's ratio by a
   sixth to a third. The engine ratio also depends on the platform: 2.0x on the
   lab's M1 Pro, about 1.2x here.
4. **What the field ratio compares is two different sets of games.** Gecko's
   pooled figure is dominated by two long games (166 of its 227 searches, 113
   and 75 consults); matched on game length (19–35 consults) the field reads
   Gecko at **2.5x** Chromium, three Gecko games against ten. The report
   carries no OS or CPU, so which of the owner's machines played which
   browser cannot be read — the remaining distance is unattributed.
5. **Field-sized boards are the real cost, in every engine.** Two production
   late-game boards (14 and 16 permanents) cost **98 ms per iteration** in
   Chromium on this machine, about 22 times a median blade board, and 139–160
   ms in Firefox. Evaluation's share more than doubles (12% → 27–34%). The 12.5 ms
   target is an engine-wide target, not a Gecko one.

## Method

The lab bench (`docs/research/scripts/brain-bench/`): one esbuild bundle of the
real `searchWithTrace` that every engine runs unchanged. This note adds three
scripts and a shared bucket module beside it, and extends one:

- **`profile-gecko.mjs`** — the Gecko profiler started with the browser
  (`MOZ_PROFILER_STARTUP`, 0.5 ms interval, `js,cpu` features), one cold
  browser per position, written at a clean quit and folded into the SAME
  buckets as `profile.mjs` (`buckets.mjs`, now shared by both). A sample
  weighs the thread CPU time since the previous one, so a preempted thread
  costs nothing. It also reports the **JIT tier** of each sample's innermost
  script frame. `--firefox <binary>` profiles a release Firefox, `--worker`
  searches in a DOM Worker.
- **`field-position.mjs`** — reads one production game's `gameStates` row and
  its `gameLibraries` companion (`npx convex data --prod`, read-only) into a
  fixture kept OUT of the repository. `entry.mjs`'s new `runField` expands it
  with the engine's own `expandState`.
- **`run-gecko-gap.mjs`** — Chromium against Playwright's Firefox and a
  release Firefox, on blade and field positions, on the page's main thread
  and in a long-lived Worker (where the app's Brain searches). Wall clock,
  interleaved rounds after a discarded warm-up, ratios per round
  (`run-browsers.mjs`'s method).
- `profile.mjs` accepts a field fixture as a position and an `--iterations`
  count.

**Positions.** Blade: `must` entries 45, 18 and 35 of `entry.mjs`'s 60 (the
lab's cheapest, median and costliest indexes; the registry has moved since, so
they are other entries now — labels below). Field: the only two field games
still stored in production. Production keeps 6 games; the issue's `jh74dkfv`
and every Gecko game of the field note are gone. `jh74q517` (seq 258) and
`jh7bkzta` (seq 217) are the field note's two WebKit games, at their final
rows: turn 14, the active player in a main or end phase, 16 and 14
permanents, 83 and 87 cards in libraries.

**A finished game made searchable.** Their last rows are game over. `runField`
clears the outcome, revives the loser at 10 life (at 0 a rollout ends on the
first damage, cheaper than the late game it stands for), gives priority to the
active player with nothing passed, and lends both seats `expert`'s knowledge
(each seat's cards, read off every zone — a fixture has no decklist). The
board, hands, libraries and every other field are the game's own. The
absolute cost per iteration depends on that revival; the engine ratios do not.

Iterations: 400 on blade positions (the ruling's target), 60 on field ones in
profiles and 40 in the gap bench (one field search is 10–30 s).

## Results

### 1. Bucket shares, V8 beside SpiderMonkey

Search time, then each bucket's share. V8: `profile.mjs` under Node (search
ms is the profiler's sampled time). Gecko: `profile-gecko.mjs`, Playwright's
Firefox, main thread (search ms is the search thread's CPU time). The two
clocks differ, so the search ms columns are not a ratio: § 2 is.

| position                                     | engine | search ms | clone | determinize | enumerate | apply | evaluate | gc  | other |
| -------------------------------------------- | ------ | --------- | ----- | ----------- | --------- | ----- | -------- | --- | ----- |
| blade 45: flanking pair, vanilla 2/2 blocked | V8     | 2639      | 8.7   | 0.5         | 5.6       | 53.5  | 12.0     | 3.5 | 16.1  |
|                                              | Gecko  | 4285      | 4.3   | 0.5         | 7.1       | 56.2  | 12.4     | 2.3 | 17.2  |
| blade 18: mdfc plays the land face           | V8     | 3394      | 6.0   | 0.5         | 9.4       | 48.0  | 12.1     | 3.3 | 20.7  |
|                                              | Gecko  | 4055      | 3.3   | 0.3         | 11.4      | 51.1  | 11.2     | 1.6 | 21.1  |
| blade 35: no Walking Ballista attack         | V8     | 16452     | 12.7  | 0.1         | 8.5       | 32.4  | 25.3     | 2.2 | 18.8  |
|                                              | Gecko  | 20535     | 6.2   | 0.1         | 9.3       | 34.4  | 28.1     | 1.4 | 20.5  |
| field `jh74q517` seq 258 (16 permanents)     | V8     | 25288     | 10.9  | 0.1         | 8.4       | 30.8  | 30.9     | 1.4 | 17.5  |
|                                              | Gecko  | 22956     | 6.2   | 0.1         | 8.3       | 31.9  | 33.5     | 1.3 | 18.7  |
| field `jh7bkzta` seq 217 (14 permanents)     | V8     | 14920     | 11.2  | 0.1         | 10.9      | 30.4  | 27.1     | 1.4 | 18.8  |
|                                              | Gecko  | 13131     | 6.9   | 0.1         | 11.8      | 30.6  | 29.2     | 1.3 | 20.1  |

`checkStateBasedActions`, inclusive: 21.4–25.8% in V8, 22.6–27.5% in Gecko.
The release Firefox in a Worker on the two field positions: shares within 1.2
points of the table's Gecko rows (clone 7.4 / 6.6, apply 30.7 / 30.4,
evaluate 32.8 / 29.2).

Gecko's JIT tiers, share of search time:

| position         | Ion  | Baseline | Baseline interpreter | interpreter | gc  |
| ---------------- | ---- | -------- | -------------------- | ----------- | --- |
| blade 45         | 66.7 | 25.9     | 4.7                  | 0.4         | 2.3 |
| blade 18         | 69.4 | 23.8     | 4.7                  | 0.5         | 1.6 |
| blade 35         | 84.6 | 12.4     | 1.4                  | 0.2         | 1.4 |
| field `jh74q517` | 81.7 | 14.7     | 2.0                  | 0.3         | 1.3 |
| field `jh7bkzta` | 74.2 | 20.8     | 3.3                  | 0.5         | 1.3 |

**Verdict: the same engine code costs the same share in both engines.** No
bucket is a Gecko outlier; cloning is cheaper in SpiderMonkey, not dearer.
The longer a search, the more of it Ion runs (67% → 85%), and garbage
collection never passes 2.3%.

Self time V8 has no counterpart for:

| SpiderMonkey self-hosted builtin            | blade 45 | blade 18 | blade 35 | field `jh74q517` | field `jh7bkzta` |
| ------------------------------------------- | -------- | -------- | -------- | ---------------- | ---------------- |
| `next` (array / map iterator, `for…of`)     | 6.8      | 8.1      | 7.0      | 5.1              | 4.9              |
| `CopyDataPropertiesUnfiltered` (`{...obj}`) | < 1.2    | < 1.2    | 1.9      | 3.1              | 2.3              |
| `FlattenIntoArray` (`flatMap`)              | 1.3      | 1.2      | 2.4      | 1.3              | 1.2              |

No caller of `next` holds more than 0.4% of a search: it is the protocol,
paid at every `for…of` over an array, `Map` or `Set` in the engine. The
largest single `flatMap` caller is `liveKeywordTriggerInstances` (1.0–1.9%);
object spread's are `cardValue` (evaluation), `buildActivatedAbilityStackItem`
and the latent-board lenses.

### 2. The gap, axis by axis

`run-gecko-gap.mjs`, 2 measured rounds after a warm-up, blade positions at
400 iterations, field positions at 40; load average 2.4–4.7. Milliseconds
per iteration are the median over positions and rounds; the ratio is each
search's time over Chromium's on the main thread at the same position and
round (median, then the range).

| boards | thread | browser                  | ms per iteration | ratio to Chromium, main | range       |
| ------ | ------ | ------------------------ | ---------------- | ----------------------- | ----------- |
| blade  | main   | Chromium 151             | 4.55             | 1.00                    | —           |
| blade  | main   | Firefox 153 (Playwright) | 5.31             | 1.19                    | 0.82 – 1.48 |
| blade  | main   | Firefox 160 (release)    | 4.43             | 0.99                    | 0.96 – 1.12 |
| blade  | worker | Chromium 151             | 4.48             | 0.77                    | 0.57 – 1.18 |
| blade  | worker | Firefox 153 (Playwright) | 5.07             | 1.07                    | 0.82 – 1.32 |
| blade  | worker | Firefox 160 (release)    | 4.21             | 0.96                    | 0.69 – 1.35 |
| field  | main   | Chromium 151             | 98.3             | 1.00                    | —           |
| field  | main   | Firefox 153 (Playwright) | 138.6            | 1.35                    | 1.35 – 1.57 |
| field  | main   | Firefox 160 (release)    | 158.2            | 1.30                    | 1.28 – 1.61 |
| field  | worker | Chromium 151             | 106.4            | 0.94                    | 0.90 – 1.08 |
| field  | worker | Firefox 153 (Playwright) | 143.3            | 1.37                    | 1.09 – 1.46 |
| field  | worker | Firefox 160 (release)    | 159.8            | 1.37                    | 1.23 – 1.63 |

**Verdict: on this machine the engine is worth 1.0–1.4x, not 2.0x and not
4.4x.** A Worker costs Firefox nothing it does not cost Chromium. The release
browser is no slower than Playwright's build. A field board costs about
**22 times** a median blade board in Chromium (98 against 4.5 ms) and 26–36
times in Firefox: it widens Firefox's ratio by 0.15–0.3.

The Gecko search thread's CPU time covers 72–82% of the search's wall time in
the profiles (§ 1's search ms against the run's wall time). The remainder is
time that thread was not running: preemption, or waiting. This note does not
attribute it.

### 3. The field's own ratio

The field note's per-game table, each game's milliseconds per iteration read
as 3300 ms over its iterations per search (every search there stopped on the
clock):

| games, by consults | Chromium games | median ms per iteration | Gecko games | median ms per iteration | Gecko / Chromium |
| ------------------ | -------------- | ----------------------- | ----------- | ----------------------- | ---------------- |
| all                | 13             | 12.0                    | 5           | 47.8                    | 3.97             |
| 19–35 consults     | 10             | 12.2                    | 3           | 30.8                    | 2.54             |
| 36 and more        | 2              | 14.2                    | 2           | 65.9                    | 4.63             |

A Gecko game was on average longer (53.6 consults against 29.2), and its two
longest (113 and 75) are longer than any Chromium game (68 at most). Later
boards cost more (field note § 1: `jh74dkfv` went from 39 to 1073 ms per
iteration inside one game), and the pooled ratio weights each game by its
searches, so the long games set it.

## The gap, attributed

| candidate                                      | reading                                                                                                                       | verdict              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| position size                                  | Firefox / Chromium on the main thread: 1.19 → 1.35 (Playwright), 0.99 → 1.30 (release), blade → field boards                  | a factor of 1.1–1.3  |
| GC                                             | 1.3–2.3% of a Gecko search, below V8's 1.4–3.5%                                                                               | ruled out            |
| a deopt or megamorphic site                    | 67–85% of the time in Ion; no bucket a Gecko outlier; the only Gecko-only cost is the 4–8% iterator protocol                  | ruled out as the gap |
| `__name` in the shipped chunk                  | the production build (Vite 8, rolldown, minified) carries no `__name` and no esbuild helper; the bench bundle has none either | ruled out            |
| the Worker                                     | Firefox in a Worker: 1.07 / 0.96 (blade), 1.37 / 1.37 (field), against 1.19 / 0.99 and 1.35 / 1.30 on the main thread         | ruled out            |
| the release browser against Playwright's build | release 160.0.1 at 0.99 (blade) and 1.30 (field) against Playwright's 153.0 at 1.19 and 1.35                                  | ruled out            |
| different games: game length                   | matched on length the field reads 2.5x (§ 3)                                                                                  | most of the distance |
| the platform                                   | the same bundle reads Firefox at 2.0x on the lab's M1 Pro (macOS, ARM) and 1.0–1.4x here (Linux, x86)                         | a factor in itself   |
| different machines, machine load               | not readable: the report carries engine, a core bucket and a mobile flag only                                                 | not attributed       |

## Slices filed

Under PRD issue #10017, each against the 12.5 ms per iteration target (Gecko
at 46 ms in the field):

| issue        | hotspot                                                                                                                                                             | expected on Gecko                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| issue #10126 | the `for…of` iterator protocol (`next`), 4–8% of every search                                                                                                       | at most 4–8%: about 46 → 43 ms per iteration          |
| issue #10127 | object spread and `flatMap` in the hot callers (`cardValue`, `liveKeywordTriggerInstances`, …)                                                                      | 3–5%: about 46 → 44 ms per iteration                  |
| issue #10128 | not a hotspot: the field report's OS family and an early-board speed reading, so the field's engine ratio can be read without the machine and game-length confounds | none; it makes the Gecko slices readable in the field |

**Issue #10126, read.** Base `2ceca7dc5` against the branch rebased on it,
Playwright Firefox 153.0 on the owner's M1 Pro (macOS, load average 30–45),
blade 45, 18 and 35 at 400 iterations. The engine (`convex/gre/**`,
`convex/cards/**` outside `sets/`) loops arrays by index and Maps and Sets by
`forEach`, array spread became `concat`/`slice`, and a lint rule keeps
`for…of` out (29 annotated exceptions: early exits from a Map or Set,
generators). `profile-gecko.mjs` now charges `next`'s self time to its
caller (`nextCallers`).

| position | `next` self share, base | `next` self share, head |
| -------- | ----------------------- | ----------------------- |
| blade 45 | 7.5                     | 0.05                    |
| blade 18 | 10.0                    | 0.25                    |
| blade 35 | 7.3                     | 0.09                    |

`run-gecko-gap.mjs`, 2 rounds: Firefox 1.45 → 1.29 ms per iteration on the
main thread and 1.48 → 1.25 in a Worker; its ratio to Chromium's main thread
1.58 → 1.55 and 1.60 → 1.56, Chromium moving 0.76 → 0.72 in the same runs
(load). `compare.mjs` in Node: head/base 1.002 median (0.956–1.048), 0 of 56
choices moved.

Together the two Gecko slices buy about a tenth. The 3.7x the ruling needs is
engine-wide work on field-sized boards: evaluation (27–34% there) and the
sweep after every applied move (`checkStateBasedActions` 21–28%), which
issue #10097 and the PRD's other engine slices own.

## Not measured

- **The field's own Gecko games.** Production no longer stores any of them;
  the field positions here are WebKit games, read in Gecko and Chromium.
- **A field position mid-game.** A game's row is patched in place: only its
  final state survives, made searchable by the revival above.
- **macOS and Windows Gecko.** One Linux machine. The lab's 2.0x is the M1
  Pro's; both lab and this note read the engine on one machine at a time.
- **`compare.mjs` in Firefox.** It reads Node's CPU clock only. A slice's
  Gecko reading is `profile-gecko.mjs`'s share before and after, and
  `run-gecko-gap.mjs` for the browser ratio.
- **Repeat-run variance.** One profile per cell; the gap bench's spread is
  over positions and rounds, not over repeated runs.

## Reproduce

From a bootstrapped worktree, with Playwright's browsers
(`bunx playwright install chromium firefox`) and, for the release rows, a
release Firefox unpacked anywhere (`$FF` below):

```bash
B=/tmp/brain-bench.js
node docs/research/scripts/brain-bench/build.mjs $B

# Field fixtures — production, read-only; run against the checkout whose
# Convex project is production. Keep the files out of the repository.
for g in jh74q517 jh7bkzta; do
  node docs/research/scripts/brain-bench/field-position.mjs $g /tmp/field-$g.json --cwd <primary checkout>
done
F="/tmp/field-jh74q517.json /tmp/field-jh7bkzta.json"

# § 1 — V8 and Gecko profiles, the same positions
node docs/research/scripts/brain-bench/profile.mjs $B /tmp/v8-blade.json --iterations 400 45 18 35
node docs/research/scripts/brain-bench/profile.mjs $B /tmp/v8-field.json --iterations 60 $F
node docs/research/scripts/brain-bench/profile-gecko.mjs $B /tmp/gk-blade.json --iterations 400 45 18 35
node docs/research/scripts/brain-bench/profile-gecko.mjs $B /tmp/gk-field.json --iterations 60 $F
node docs/research/scripts/brain-bench/profile-gecko.mjs $B /tmp/gk-field-rel.json --iterations 60 --firefox $FF --worker $F

# § 2 — the gap bench
node docs/research/scripts/brain-bench/run-gecko-gap.mjs $B /tmp/gap.json --firefox $FF --rounds 2 45 18 35 $F
```

Each output JSON carries per-position `shares`, `tiers` (Gecko), `inclusive`
and `topSelf`; `run-gecko-gap.mjs` prints its summary table.
