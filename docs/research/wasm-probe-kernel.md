# WebAssembly for the search, measured: one probe kernel in three arms (issue #10471)

> **Dated:** 2026-11-23, at `badd9fe601` (base tip), on the development MacBook
> (Apple M1 Pro, 8 cores, 16 GB) while it was also the pipeline's runner: load
> average 4–34 throughout. Node 24.21.0, Playwright 1.62.1 (Chromium
> 151.0.7922.34, WebKit 26.5), Firefox 160.0.1 (the release build, § Method),
> Homebrew clang 22.1.8. **Every number below is as of that commit, that
> machine and that day.** Slice of PRD issue #10017; the owner's ruling is
> § 9.

**Question.** The owner asked on 2026-11-22 what a WebAssembly engine would
buy the Brain's search. ADR 0183 keeps the search on the client and rules a
rewrite in another language out, "reopened only if in-place engine work is
exhausted and the field ratio is still below a third"; it also says the factor
such a rewrite would run faster by is one "this project has not measured".
This note measures it, without rewriting the engine.

**Why a kernel.** There is no WebAssembly build of the engine to switch on.
The engine is TypeScript, and the same code run by a JavaScript interpreter
compiled to WebAssembly gives up the browser's optimizing compiler, so the
only honest comparison rewrites a piece. The profile says which: on four
production late-game boards the rollout policy's probe (clone the state,
apply one candidate move, settle state-based actions and continuous effects,
evaluate the board) is 62–73% of every iteration, with no single hotspot
inside it (`rollout-policy-cost.md` § 1). The bench is that probe, over a
reduced rules subset, written three times.

**The decision rule, stated before the numbers.** It is the one issue #10471
proposed on 2026-11-22, before the bench existed: **ADR 0183 is reopened only
if arm C (WebAssembly) beats arm B (flat memory in JavaScript) by 2× or more
on field-shaped boards in every engine.** Otherwise the flat layout in
TypeScript is the lever, and the note says what adopting it would touch (§ 8).

**Verdict up front.**

1. **WebAssembly is 1.7–2.6× faster than the same flat layout in
   JavaScript, and the rule is not met.** Arm C beats arm B by 2.60× in
   Chromium, 2.38× in Firefox and 1.73× in WebKit (§ 2). The rule asks 2× in
   every engine; WebKit misses it.
2. **The data layout is the larger factor, and most of it is the clone.**
   Flat JavaScript is 10–14.5× faster than objects on the kernel. The clone
   is 47–70% of the object arm's probe and 40–53 ns flat. On the two
   steps that do the rules work, settle and evaluation, flat JavaScript
   gains 3.2–7.2× (§ 4).
3. **The kernel is a fifteenth to a fortieth of the real probe**, and the
   real probe is not shaped like it. The engine's own probe on the same
   board shape costs 400–1470 µs against the object arm's 11–39 µs, and
   its clone is 1–8% of it; one evaluation is 36–54% (§ 5).
4. **The kernel cannot say the engine gap would close.** In WebAssembly the
   three engines run within 7% of each other at the median (14% on one
   board), but the object arm shows no gap to begin with: Firefox runs it faster than Chromium, while
   it runs the engine's own probe 1.5–2.3× slower (§ 3, § 5).
5. **On a whole iteration WebAssembly adds 5–30%.** A probe that cost
   nothing would buy 2.6–3.7× per iteration under today's rollout policy and
   1.7–2.0× under `topk:3`. Projected step by step, flat JavaScript reaches
   1.9–2.5× and 1.5–1.7×, and WebAssembly adds 1.10–1.30× and 1.05–1.12×
   on top (§ 6) — a ceiling, since the kernel is a subset of the rules.
6. **Recommendation: do not reopen ADR 0183.** The lever the numbers point
   at is inside it: a flat reading of the evaluation, in TypeScript (§ 8).
   The owner's ruling is § 9.

## The kernel

One probe, as `selectRolloutMove` runs it once per candidate
(`convex/gre/search.ts`): copy the position, apply one candidate move to the
copy, settle it, evaluate it, return a number. The rules are a declared
subset (`docs/research/scripts/brain-bench/wasm-probe/layout.mjs`):

- **Cards.** 18 definitions: a land, ten creatures (among them a flier with
  vigilance, a trampler, a defender, a reach body, a legendary first-striker
  and a lord), two enchantments with a static ability, two Auras, three
  instants. A definition is read-only in every arm, as in the engine.
- **A state.** Two players (life, a hand of up to 8, a library of 28–39, a
  graveyard of 5–10), up to 48 permanents with ten fields each (definition,
  controller, tapped, summoning-sick, damage, +1/+1 counters, −1/−1
  counters, attached-to, timestamp, attacking), up to 16
  until-end-of-turn effects.
- **Moves** (the candidate a probe applies): pass; play a land; cast a
  creature or an enchantment (tap lands for its cost, it enters at once);
  cast an Aura on a creature; cast an instant on a creature or a player
  (damage, or ±N/±N until end of turn); declare one attacker.
- **Continuous effects.** Layer 6: keywords a static grants. Layer 7c: power
  and toughness from four kinds of static (creatures you control, other
  creatures you control of a subtype, untapped creatures you control, the
  enchanted creature) and from until-end-of-turn effects. Layer 7d: counters.
- **State-based actions**, repeated until none applies, the continuous
  effects recomputed before every pass: toughness 0 or less, lethal damage,
  an Aura attached to nothing or to a non-creature, the legend rule (the
  newest copy stays, where the real rule asks its controller), +1/+1 against
  −1/−1 counters, a player at 0 life.
- **Evaluation**, in integers, from one player's side: life, cards in hand,
  lands (untapped worth more), every creature's power, toughness, damage and
  eight keywords, the other permanents, and for every creature able to
  attack the sturdiest untapped creature the defender could block it with
  (a flier needs a flier or reach) — the one term that is quadratic in the
  board, as the engine's predicted combat exchange is.

**Not in the kernel:** the stack and priority, triggers, replacement
effects, mana colours, target legality, combat damage, layers 1 to 5,
choices, and the Effect Script interpreter — a card here is a row of
numbers, not a script. The kernel's `apply` is therefore a few assignments;
the engine's is the rules engine.

**The boards** (`boards.mjs`) are synthetic and seeded, shaped like the four
field boards of `rollout-policy-cost.md` § 1: 21, 26 and 30 permanents, two
seeds each, with as many candidates as a probing ply has there (5.2–8.1).
No production row is in the repository. Nine of the 40 probes kill something in the settle step and need a
second pass: a burn spell or a shrink on a creature, a second copy of the
legendary creature already out. On one board the first copy carried an Aura,
which follows it in a third pass. The other 31 settle in one pass, some of
them after moving characteristics without killing (an Aura, a pump).

| board          | permanents | candidates | library | objects per clone (arm A) | state (arms B, C) |
| -------------- | ---------- | ---------- | ------- | ------------------------- | ----------------- |
| `21p/6c/66674` | 21         | 6          | 28 + 39 | 134                       | 3040 bytes        |
| `21p/6c/66675` | 21         | 6          | 38 + 32 | 137                       | 3040 bytes        |
| `26p/6c/66690` | 26         | 6          | 31 + 32 | 133                       | 3040 bytes        |
| `26p/6c/66691` | 26         | 6          | 35 + 29 | 135                       | 3040 bytes        |
| `30p/8c/66706` | 30         | 8          | 37 + 38 | 147                       | 3040 bytes        |
| `30p/8c/66707` | 30         | 8          | 35 + 36 | 148                       | 3040 bytes        |

`objects per clone` is what arm A's clone allocates; the engine's own clone
of the same board shape allocates 133–146 (§ 5).

## Method

**Three arms, one kernel.**

- **Arm A — objects, as today** (`kernel-objects.mjs`). The engine's data
  model and idioms: a state object holding `players[]`, each with `hand`,
  `library`, `graveyard` and `battlefield` arrays of card instances; an
  instance is an object with a string id, a shared reference to its
  definition and its characteristic lists; a permanent is found by a linear
  scan for its id; a keyword is a string in `staticAbilities`; a static's
  reach is an `applies` predicate on the definition; layer 6 is written back
  onto the instance as a fresh array at every settle pass and power and
  toughness are computed on demand through a per-pass cache, as
  `syncLayer6` and `getEffectivePT` do; no loop is a `for…of`. The clone is
  `convex/gre/clone.ts`'s `cloneValue` copied in, both of its per-engine
  variants and its shared keys.
- **Arm B — flat memory, still JavaScript** (`kernel-flat.mjs`). The state
  is 760 32-bit words in one `Int32Array` (3040 bytes): integer ids,
  struct-of-arrays, keywords as a bitmask. A clone is one
  `Int32Array.prototype.set`.
- **Arm C — the same layout compiled to WebAssembly** (`kernel.c`). Arm B
  function for function, on the same words at the same offsets in linear
  memory; a clone is one `memory.copy`. The sweep over the candidates runs
  inside the module; a fourth reading calls the module once per probe from
  JavaScript.

**The three arms compute the same thing.** Before any timing, in every
engine, the payload runs every probe of every board in the three arms and
refuses to go on unless they return the same number, and it checks the
module's layout constants against JavaScript's (`entry-wasm-probe.mjs`). To
keep the work equal, every arm recomputes power and toughness once per
settle pass and once more at the start of the evaluation, as the engine's
evaluation opens its own layer-7 pass. One difference stays, in arm A's
favour: at that point arms B and C recompute the granted keywords too,
while arm A reads the ones its last settle pass wrote back onto the
instance, as the engine does.

**The toolchain: C through clang, not Rust or AssemblyScript.** The issue
left the choice between those two. Neither toolchain is on the bench
machine, and this pass was not allowed to download one. What the machine has
is Homebrew's clang 22.1.8, which targets `wasm32`. LLVM is the code
generator Rust compiles through, so for integer loops over linear memory C
through clang reads what Rust would at best: C has no bounds checks, which
safe Rust adds. AssemblyScript optimizes with Binaryen alone and would be
expected at or below it (Not measured). Build:
`clang --target=wasm32-unknown-unknown -O3 -ffreestanding -nostdlib
-mbulk-memory -c kernel.c`. Homebrew's `llvm@22` has no `wasm-ld`, and a
single translation unit with nothing undefined needs no linking: a
170-line script (`link-wasm-object.mjs`) adds the export section the object
file lacks and drops its relocation sections. The code section is the
compiler's, byte for byte. The module is 15,964 bytes. Nothing was added to
`package.json` or the lockfile.

**Engines.** Chromium and WebKit are Playwright's builds, headless. **Firefox
is the release build, in a real window**, opened in the background on a
throwaway profile and driven over HTTP (`run-wasm-probe.mjs`,
`firefox-release`). Playwright's Firefox cannot read arm C: it drives the
page through the debugger, and a debugged page gets no optimizing
WebAssembly compiler. With the baseline compiler switched off
(`javascript.options.wasm_baselinejit`) that build reports "no WebAssembly
compiler available", and its arm C read 5–10 µs per probe, three times its
own arm B and nine times Chromium's arm C. The release build started
headless on a fresh profile never loaded the page, hence the window. In
every engine the kernel runs in a dedicated Worker.

**Reading.** A browser has only a wall clock, a coarse one (1 ms in Firefox
and WebKit), and the machine was loaded. So a sample is as many sweeps of a board's candidates as take 250 ms (300
for the anchor), the count calibrated per engine, arm and board and then
held; the three browsers stay open together and every round
visits each of them, each board and each arm, the orders rotating; the
first round is discarded. A cell is the median of the measured rounds, a ratio the median of the
per-round ratios, and a range is over the six boards. The median is the
nearest-rank one the other bench notes use (`stats.mjs`): the lower of the
two middle values of an even count. The arms were read in 8 measured rounds at load 4–17, the
anchor in 5 at load 14–34. A first pass of the arms the same morning, at
load 26–167, read B ÷ C at 2.61, 2.37 and 1.74 against the 2.60, 2.38 and
1.73 below; it is not used, because one of its cells was miscalibrated.

**The anchor.** Each kernel board is lowered to real cards (`boards.mjs`,
`anchorSpec`: the same permanents by kind and side, the same hand, a library
of the same size) and built by the engine's own scenario builder. The
engine's probe is `selectRolloutMove` over the engine's own enumeration of
that position, timed beside arm A in the same Worker and the same rounds
(`entry-wasm-anchor.mjs`). Three of its parts are timed alone on the same
state: `cloneGameState`, one `checkStateBasedActions` of a fresh clone, one
`evaluate`.

## Results

### 1. Microseconds per probe

Median of the 8 measured rounds; A, B and C are the arms.

| board          | Chromium A | Chromium B | Chromium C | Firefox A | Firefox B | Firefox C | WebKit A | WebKit B | WebKit C |
| -------------- | ---------- | ---------- | ---------- | --------- | --------- | --------- | -------- | -------- | -------- |
| `21p/6c/66674` | 26.5       | 1.42       | 0.54       | 21.7      | 1.41      | 0.58      | 11.2     | 0.92     | 0.53     |
| `21p/6c/66675` | 27.5       | 1.40       | 0.52       | 21.6      | 1.39      | 0.56      | 11.3     | 0.89     | 0.50     |
| `26p/6c/66690` | 29.9       | 2.07       | 0.81       | 25.0      | 2.06      | 0.86      | 13.6     | 1.35     | 0.79     |
| `26p/6c/66691` | 29.8       | 2.00       | 0.77       | 24.8      | 2.00      | 0.81      | 13.3     | 1.29     | 0.74     |
| `30p/8c/66706` | 35.1       | 2.67       | 1.03       | 29.9      | 2.63      | 1.13      | 16.0     | 1.78     | 1.03     |
| `30p/8c/66707` | 33.6       | 2.44       | 0.90       | 28.7      | 2.38      | 1.04      | 14.8     | 1.60     | 0.91     |

### 2. Arm against arm

Median over the six boards, range in brackets.

| engine   | A ÷ B            | B ÷ C            | A ÷ C            | C, one call per probe ÷ C |
| -------- | ---------------- | ---------------- | ---------------- | ------------------------- |
| Chromium | 14.5 (13.2–19.7) | 2.60 (2.58–2.70) | 37.6 (34.3–52.6) | 1.02 (1.01–1.03)          |
| Firefox  | 12.1 (11.4–15.6) | 2.38 (2.27–2.48) | 28.9 (26.5–38.1) | 1.01 (1.00–1.01)          |
| WebKit   | 10.0 (9.0–12.8)  | 1.73 (1.71–1.77) | 17.2 (15.5–22.7) | 1.04 (1.03–1.07)          |

**B → C, what WebAssembly itself adds: 2.60× in Chromium, 2.38× in Firefox,
1.73× in WebKit**, tight across the boards. **A → B, what the data layout
buys while staying in JavaScript: 10–14.5×.** One call from JavaScript per
probe costs 1–4% over the sweep inside the module.

### 3. The engine gap, arm by arm

Each engine's time over Chromium's, same arm, same rounds.

| engines            | A                | B                | C                |
| ------------------ | ---------------- | ---------------- | ---------------- |
| Firefox ÷ Chromium | 0.82 (0.78–0.86) | 0.99 (0.97–1.00) | 1.07 (1.06–1.14) |
| WebKit ÷ Chromium  | 0.44 (0.41–0.45) | 0.65 (0.63–0.66) | 0.98 (0.95–1.01) |

In arm C the three engines run within 7% of each other at the median (14%
on one board). That is not the engine gap closing, because **the kernel has
no gap to close**: arm A is FASTER in Firefox than in Chromium (0.82×) and
twice as fast in WebKit (0.44×), while the engine's own probe on the same
boards is 1.5–2.3× slower in Firefox than in Chromium and level in WebKit
(§ 5). Gecko's cost is in
code the kernel does not have. What the kernel does show is that compiled
code over linear memory runs alike in the three engines, and that
JavaScriptCore's lead on small-object and typed-array JavaScript is gone
once the code is compiled ahead of time.

### 4. Where a probe's time goes, and what each step gains

A step's time is the difference of two samples of the same round, one
stopped before the step and one after it. The last difference is against
the whole probe's own sample, whose loop folds the result with a multiply
where the stopped ones add: that is inside the evaluation's figure, and it
weighs most where a probe is shortest, in arm C. Shares of a whole probe, %, median
over the boards:

| engine   | arm | clone | apply | settle | evaluate |
| -------- | --- | ----- | ----- | ------ | -------- |
| Chromium | A   | 70    | 0     | 13     | 13       |
| Chromium | B   | 2     | 2     | 39     | 55       |
| Chromium | C   | 5     | 2     | 36     | 54       |
| Firefox  | A   | 56    | 1     | 17     | 22       |
| Firefox  | B   | 2     | 3     | 34     | 59       |
| Firefox  | C   | 5     | 2     | 35     | 55       |
| WebKit   | A   | 47    | 1     | 20     | 27       |
| WebKit   | B   | 4     | 3     | 34     | 56       |
| WebKit   | C   | 5     | 1     | 35     | 56       |

What each step gains from one arm to the next (the step's time in the first
arm over its time in the second; median over the boards, range). Clone and
apply are read together: in arm A the apply alone is inside the clone's
noise.

| engine   | arms  | clone + apply       | settle        | evaluate      |
| -------- | ----- | ------------------- | ------------- | ------------- |
| Chromium | A ÷ B | 226.3 (216.3–242.7) | 5.5 (5.1–5.7) | 3.5 (3.2–3.8) |
| Chromium | B ÷ C | 1.8 (1.7–1.8)       | 2.8 (2.7–2.9) | 2.6 (2.6–2.7) |
| Firefox  | A ÷ B | 135.4 (127.6–140.8) | 6.7 (6.2–7.2) | 4.7 (4.4–5.0) |
| Firefox  | B ÷ C | 1.8 (1.8–1.9)       | 2.3 (2.2–2.5) | 2.5 (2.4–2.6) |
| WebKit   | A ÷ B | 73.6 (69.8–76.9)    | 6.6 (6.5–7.2) | 4.8 (4.4–5.2) |
| WebKit   | B ÷ C | 1.7 (1.7–1.8)       | 1.7 (1.6–1.8) | 1.8 (1.8–1.8) |

**Arm A is mostly its clone** (47–70% of a probe: 20.9–23.5 µs in
Chromium, 14.0–15.7 in Firefox, 6.1–6.9 in WebKit, for 133–148 objects),
and a flat clone is 40–53 ns in every engine (the clone alone, per board;
`summarize-wasm-probe.mjs` prints these beside the tables). That one step is why A ÷ B reads 10–14.5×.
**On the two steps that do the rules work, flat JavaScript is 3.2–7.2×
faster than objects, and WebAssembly a further 1.6–2.9×.** In arms B and C
the probe is the same shape: settle a third, evaluation a little over half.

### 5. The anchor: how much of the real probe the kernel is

| board          | permanents | engine's candidates | of them casts | objects per clone, engine | arm A |
| -------------- | ---------- | ------------------- | ------------- | ------------------------- | ----- |
| `21p/6c/66674` | 21         | 48                  | 46            | 133                       | 134   |
| `21p/6c/66675` | 21         | 48                  | 46            | 134                       | 137   |
| `26p/6c/66690` | 26         | 58                  | 56            | 133                       | 133   |
| `26p/6c/66691` | 26         | 58                  | 56            | 133                       | 135   |
| `30p/8c/66706` | 30         | 68                  | 66            | 146                       | 147   |
| `30p/8c/66707` | 30         | 68                  | 66            | 146                       | 148   |

Per engine, median over the six boards and range. The three shares are of
the engine's own probe: `cloneGameState`, one `checkStateBasedActions` of a
fresh clone (the clone subtracted), one `evaluate`.

| engine   | engine's probe, µs | arm A, µs        | engine ÷ arm A   | clone, % of the engine's probe | one SBA check, % | one evaluation, % |
| -------- | ------------------ | ---------------- | ---------------- | ------------------------------ | ---------------- | ----------------- |
| Chromium | 487 (411–643)      | 32.6 (29.4–38.5) | 14.9 (13.3–17.3) | 7 (6–8)                        | 9 (7–9)          | 47 (42–52)        |
| Firefox  | 810 (655–1471)     | 26.6 (23.3–32.5) | 30.2 (25.0–39.2) | 4 (2–6)                        | 7 (5–8)          | 40 (36–44)        |
| WebKit   | 500 (403–659)      | 13.3 (11.5–16.1) | 38.1 (34.7–45.9) | 2 (1–2)                        | 9 (7–10)         | 48 (45–54)        |

**The kernel is a fifteenth to a fortieth of the real probe.** The engine's
probe costs 400–1470 µs on these boards (the four field boards read
930–3100 µs, comment of 2026-11-21 on issue #10134); arm A costs 11–39 µs.
The board shape matches: the engine's clone allocates 133–146 objects, arm
A's 133–148. The cost does not, and the split says where the difference is:

- **The clone is 1–8% of the engine's probe**, against 47–70% of arm A's.
  The engine's clone (34–44 µs in Chromium and Firefox, 8–10 in WebKit) is
  already as cheap as an object clone gets; the step a flat layout removes
  outright is a small one in the engine.
- **One evaluation is 36–54%** (194–508 µs). The kernel's whole evaluation
  is 3–7 µs in arm A: the engine evaluates sixteen terms, several of them
  over the hand and the mana, where the kernel has one quadratic term.
- **One state-based-action check is 5–10%**; the remaining 35–50% is the
  rest of the probe: the move's own application through the rules engine,
  which the kernel replaces with a few assignments, and whatever the
  policy's value reads beyond one evaluation.

The engine enumerates 48–68 candidates on these boards, 46–66 of them
casts (first table), where the kernel probes six to eight. A probe's cost does not depend
on how many there are.

Firefox's probe is 1.53–2.26× Chromium's here (per board, the median of
the per-round ratios; 1.65 over the boards) and WebKit's is level
(0.96–1.06).

### 6. A whole iteration, as a ceiling

Two inputs from `rollout-policy-cost.md`: the probes are 62–73% of an
iteration on the four field boards under today's policy (§ 1, a V8 profile;
the same shares are applied to the three engines here), and 40–49%
under `topk:3`, the policy the owner ruled for on 2026-11-22 — derived per
board from § 1's share and § 2's time per iteration at 60 iterations, as
1 − (1 − share) ÷ ratio, not measured there. One input from this note: the
probe's speed-up, built step by step. The engine's probe is split as the
anchor reads it (clone, one evaluation, the rest), and each part is divided
by the kernel's ratio for that step — the rest by the settle step's, the
nearest thing the kernel has to rules code walking the board. A whole
iteration then gains 1 ÷ (1 − share + share ÷ speed-up).

| engine   | policy         | probes, % of an iteration | probe, flat JS | iteration, flat JS | probe, WebAssembly | iteration, WebAssembly | WebAssembly ÷ flat JS, iteration | iteration, a free probe |
| -------- | -------------- | ------------------------- | -------------- | ------------------ | ------------------ | ---------------------- | -------------------------------- | ----------------------- |
| Chromium | today's policy | 62–73                     | 4.6×           | 1.93–2.31×         | 12.2×              | 2.31–3.00×             | 1.19–1.30×                       | 2.61–3.65×              |
| Chromium | `topk:3`       | 40–49                     | 4.6×           | 1.46–1.62×         | 12.2×              | 1.58–1.82×             | 1.09–1.12×                       | 1.67–1.96×              |
| Firefox  | today's policy | 62–73                     | 5.9×           | 2.05–2.52×         | 14.1×              | 2.34–3.07×             | 1.14–1.22×                       | 2.61–3.65×              |
| Firefox  | `topk:3`       | 40–49                     | 5.9×           | 1.50–1.69×         | 14.1×              | 1.59–1.84×             | 1.06–1.09×                       | 1.67–1.96×              |
| WebKit   | today's policy | 62–73                     | 5.7×           | 2.04–2.49×         | 9.9×               | 2.25–2.88×             | 1.10–1.15×                       | 2.61–3.65×              |
| WebKit   | `topk:3`       | 40–49                     | 5.7×           | 1.49–1.68×         | 9.9×               | 1.56–1.79×             | 1.05–1.06×                       | 1.67–1.96×              |

Read it as a ceiling, in three steps.

- **A free probe** — the probe's whole share gone — buys 2.6–3.7× per
  iteration today and **1.7–2.0× under `topk:3`**. No arm can beat that
  column, and it does not depend on the kernel.
- **Flat JavaScript**, if every step of the real probe gained what the
  kernel's same step gains, buys 1.9–2.5× today and 1.5–1.7× under
  `topk:3`.
- **WebAssembly over flat JavaScript** then adds **1.10–1.30× today and
  1.05–1.12× under `topk:3`**. A factor of 1.7–2.6 on the probe becomes
  5–30% on the iteration, because most of what is left of the iteration is
  not the probe.

It is a ceiling because the kernel is a subset: the real probe's rest is
the rules engine, and nothing here shows it gaining what the kernel's
settle step gains.

## 7. What the bench does not measure

Three costs of a WebAssembly engine are outside a kernel bench. They are
design text here, with the few numbers the bench happens to give.

- **A second engine kept in step with the first.** The kernel is 18 rows of
  numbers and six move kinds. The engine it stands for is 341 source files
  and 264,334 lines under `convex/gre/` (tests excluded), an Effect Script
  interpreter of 10,665 lines, and card definitions that carry code: 424
  `resolve` / `resolveSteps` closures across 111 set files, and `applies` /
  `condition` predicates on static effects. The server stays authoritative and stays TypeScript
  (Convex mutations), so a WebAssembly search engine is a SECOND rules
  engine: every new card, mechanic and rules fix lands twice, and a
  divergence between the two is a Bot that plans on rules the game does not
  have. ADR 0000 rejected exactly that, and ADR 0183 repeated it. Nothing
  measured here changes that cost; it is the larger part of the decision.
- **Boundary crossings.** A call into the module costs nothing readable at
  this probe size: one call per probe reads within 1–4% of the sweep
  inside the module (§ 2). The crossing that costs is the state. A hybrid —
  the tree and the rules in TypeScript, the probe in WebAssembly — has to
  turn the object graph into flat words before it can probe, once per
  probing ply. That walk is what arm A's clone is: 6–24 µs per board
  in the kernel, and `cloneGameState` on the same board shape is
  8–44 µs (§ 5). A ply with six candidates would pay one such walk to
  save six; the saving is real only if the move application also runs
  inside the module, which is the second engine again.
- **Bundle size.** The kernel's module is 15,964 bytes, more than half of
  them its zeroed static arrays. It says nothing about an engine's: the anchor bundle, which is the
  engine and the card registry unminified, is 9.2 MB of JavaScript. A
  second engine ships beside the first, not instead of it.

## 8. What adopting the flat layout in the engine would touch

Counts at `badd9fe601`, tests excluded.

- **The state's shape.** `GameState` has 124 top-level fields, 115 of them
  optional and most of those objects, arrays or records.
  `CardInstanceState` has 176 fields, 167 optional, each with its row in
  `CARD_FIELD_LIFECYCLE`; about 60 are nested. A flat layout gives every one
  of them an offset, and the sparse ones a side table.
- **Identity and lookup.** A permanent is a string id found by a linear
  scan: `findOnBattlefield` has about 150 call sites, `findPermanent` about
  65, `getPlayer` about 300. Integer slots replace all of them.
- **The clone.** `cloneGameState` has 63 call sites (29 in `search.ts`, 13
  in `ai/dominance.ts`). The server path uses `structuredClone` and the
  stored snapshot has its own compact form (`serialize.ts`, 3158 lines); a
  flat state needs a codec to and from both.
- **Continuous effects.** Layers 2 to 6 are written back onto the instance
  as fresh arrays of strings (`types`, `subtypes`, `staticAbilities`);
  layer 7 is computed on demand (`getEffectivePT`, about 54 call sites).
  Statics reach their targets through `applies` closures on the definition.
  Bitmasks and integer columns replace the lists; a closure cannot read a
  flat state unless it is rewritten against it.
- **Card code.** Every `resolve` closure and every Op of the interpreter
  (`effects/interpreter.ts`, 10,665 lines) reads and writes the object
  state.

So the flat layout is not a change to the clone: it is the engine's data
model, and the kernel's gain from A to B comes from all of it at once
(§ 4). What ADR 0183 allows is the part that can be done in place:

- **A flat reading of the evaluation.** One evaluation is 36–54% of the
  engine's probe (§ 5), and the kernel's evaluation step gains 3.2–5.2× from
  objects to flat JavaScript (§ 4). `evaluate` reads the board and writes
  nothing, so it can read integer columns built from the object state once
  per probe — a walk of the battlefield, 21–30 permanents here, not of the
  133–146 objects of the state. This is the in-place lever the numbers point
  at. It composes with incremental evaluation (`rollout-policy-cost.md`,
  Not measured) and it is not measured here on the real `evaluate`.
- **Not the clone.** It is 1–8% of the engine's probe. A flat state would
  make it free and would cost the whole data model.
- **Not the state-based actions alone.** One check is 5–10% of the probe on
  these boards, whose cards are plain; a sampled V8 profile of two field boards reads
  `checkStateBasedActions` at 23.5% and 24.7% of the search (comment of
  2026-11-21 on issue #10134), so the answer may differ on real late
  boards.

## 9. The owner's ruling

**Pending.** The rule above was read as follows: arm C beats arm B by 2.60×
in Chromium, 2.38× in Firefox and **1.73× in WebKit**. The rule asks for 2×
in every engine, so **by the rule ADR 0183 is not reopened**, and the note's
recommendation agrees for a second reason the rule does not carry: on a
whole iteration WebAssembly adds 1.05–1.30× over flat JavaScript (§ 6),
against a second rules engine kept in step for every card (§ 7).

The questions for the owner:

1. **Close the WebAssembly question as measured**, ADR 0183 unchanged, with
   a pointer from its "Engine rewrite" section to this note? Recommended:
   yes. Two of three engines pass the 2× bar and WebKit does not; if the
   owner reads "every engine" as too strict, § 6 is the number to weigh
   instead of § 2.
2. **A follow-up slice that measures a flat reading of `evaluate` on the
   real engine** (§ 8), as a prototype with its own decision rule, after
   `topk:3` (issue #10473) lands and the probe's share is re-read?
   Recommended: yes.
3. **Anything else this bench should read before the question closes** — a
   Rust or AssemblyScript arm, release Chrome and Safari, a phone?
   Recommended: no; none of them moves § 6's ceiling.

## Not measured

- **The real engine in WebAssembly, or flat.** Every arm-to-arm number here
  is the kernel's. The projection of § 6 is arithmetic on the kernel's step
  ratios and the engine's own split; it is a ceiling, not a forecast.
- **Rust and AssemblyScript.** Arm C is C through LLVM (Method). Rust
  compiles through the same code generator and adds bounds checks unless
  written `unsafe`; AssemblyScript optimizes with Binaryen alone. Neither
  was run.
- **WebAssembly features beyond the baseline.** No SIMD, no threads, no
  garbage-collected types. The kernel's loops are short and branchy; SIMD
  was not tried.
- **A wider or deeper kernel.** Six boards of three shapes, one hand, six to
  eight candidates. No stack, no triggers, no card scripts: the parts of a
  probe where the engine spends the time arm A does not (§ 5).
- **Arm A in other hands.** Arm A is one rendering of the engine's idioms.
  Its settle and evaluation steps are slower than arm B's by a factor that
  depends on how string keywords, per-pass caches and predicate closures
  were written; the order of magnitude is the reading, not the digit.
- **Release Chrome and Safari.** Chromium and WebKit are Playwright's
  builds. Release Chrome, opened the way Firefox was, did not answer; Safari
  was not tried.
- **Devices.** One Apple-silicon laptop. No phone, no x86.
- **The field.** A probe in the field runs on a different board at every
  ply; here every sample repeats the same few probes, which is the best
  case for every arm's compiler and cache.

## Reproduce

```bash
B=docs/research/scripts/brain-bench/wasm-probe
# clang with the wasm32 target (Homebrew llvm@22 by default; --clang <path>)
node $B/run-wasm-probe.mjs build /tmp/wasm-probe
# the three arms, three engines (Firefox opens a background window)
node $B/run-wasm-probe.mjs run /tmp/wasm-probe /tmp/run.json --rounds 8 --sample-ms 250
# arm A beside the engine's own probe
node $B/run-wasm-probe.mjs anchor /tmp/wasm-probe /tmp/anchor.json --rounds 5 --sample-ms 300
# the tables above
node $B/summarize-wasm-probe.mjs /tmp/run.json /tmp/anchor.json
```
