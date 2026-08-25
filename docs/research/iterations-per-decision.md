# Real iterations per decision, in the browser (issue #2682)

**Question.** `medium` caps the ISMCTS search at `{ iterations: 400, timeMs:
1500 }`. Nobody had measured, in an actual browser tab, whether a real
decision at `medium` completes the full 400-iteration budget or gets cut
short by the 1500ms wall clock — the difference between "the blade suite's
400-iteration budget is representative of live play" and "live play searches
far less than the blade suite ever tests."

**Why a browser, not a unit test.** `convex/gre/__tests__/decisionTrace.bot.test.ts`
proves the STOP LOGIC is correct (an injected clock deterministically forces
`stoppedBy: "time"` in one case and `"iterations"` in the other — see the two
new tests there). It says nothing about which one actually fires on real
hardware running real V8, because an injected clock has no wall-clock cost at
all. This document reports the real number, using the real `now` (i.e., no
injected clock) inside a real browser tab.

**Verdict up front.** Across the 4 representative positions with a real
decision to make (mulligan has none — see below), `medium`'s full
400-iteration budget completed in every case, using between **4.5% and 93.8%**
of the 1500ms wall-clock cap. The busiest position (a rich main phase with 25
legal moves) came closest to the cap but did not hit it. At `medium`, on this
hardware, **the iteration budget is the binding constraint, not the wall
clock** — the opposite of the concern the issue opened with. That does not
generalize to `hard` (1200 iterations, 3000ms) or to slower client hardware
(a phone browser is not this machine); see Caveats.

## Method

Ran the ACTUAL `searchWithTrace` (`convex/gre/search.ts`) — the same module
the production `brain.worker.ts` bundles for the client Worker — inside a
real headless Chromium tab (Playwright, already vendored as a devDependency),
pointed at the live Vite dev server. Vite's dev server transforms and serves
any project TS module as real ESM on request, so the harness `import()`s
`convex/gre/search.ts`, `convex/gre/difficulty.ts`, `convex/cards/index.ts`
and the shared test fixture builders (`convex/cards/__tests__/setup.ts`)
DIRECTLY from the browser tab — no bundling step, no mock, and critically:
**no injected clock**. `SearchBudget.now` is left `undefined`, so
`runSearchWithTrace` falls back to the browser's real `performance.now()`.

Five representative positions, `DIFFICULTY_BUDGETS.medium`, one search each:

1. **Opening land drop** — turn 1 precombat main, hand = 2 lands + a mana
   dork, empty boards.
2. **Rich main phase** — turn 6, 5 lands + 3 creatures on each side, hand =
   2 burn spells + a pump spell + 2 more creatures (approximates the issue's
   "~80-move main phase" — this fixture reaches 25 legal root moves, not 80;
   see Caveats).
3. **Combat declaration** — turn 6, p1 has a Hill Giant + Grizzly Bears
   (both ready), p2 has one Hill Giant blocker — a genuine risk/reward
   attacker-subset decision (`combat: { attackerIds: [], confirmed: false,
… }`, the marker `enumerateMoves` needs to offer `declare-attackers`
   moves at all — omitting it silently collapses to a bare `pass`).
4. **Instant-speed response window** — p2's spell is on the stack, p1 holds
   priority with Lightning Bolt + Giant Growth in hand and untapped mana.
5. **Mulligan** — NOT measured. `runSearchWithTrace` special-cases
   `state.phase === "MULLIGAN"` and returns `{ trace: null }`
   UNCONDITIONALLY, before the search loop ever runs ("no real decision
   \[…] a forced mulligan window", `search.ts`). The bot's mulligan call is a
   separate heuristic, `decideMulligan()` (`src/lib/ai/brain.ts:1451`), which
   never touches ISMCTS. There is no iteration count to report for this
   bucket — the honest answer is "N/A by construction," not a number forced
   out of an unrelated code path.

Harness (trim the fixture bodies to taste; run against `bun run dev` on the
port you choose):

```js
import { chromium } from "playwright";
const BASE = "http://localhost:5199"; // your `bun run dev` port
const script = `
async function run() {
  const { searchWithTrace } = await import("${BASE}/convex/gre/search.ts");
  const { DIFFICULTY_BUDGETS } = await import("${BASE}/convex/gre/difficulty.ts");
  const { getCardByName } = await import("${BASE}/convex/cards/index.ts");
  const { makeInstance, makePlayer, makeState } =
    await import("${BASE}/convex/cards/__tests__/setup.ts");
  // ...build a GameState fixture with makeState/makePlayer/makeInstance...
  const { trace } = searchWithTrace(state, "p1", DIFFICULTY_BUDGETS.medium, seed);
  return trace; // { iterationsCompleted, iterationsRequested, elapsedMs, stoppedBy, ... }
}
return await run();
`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "load" });
console.log(await page.evaluate(`(async () => { ${script} })()`));
await browser.close();
```

## Results

`medium` = `{ iterations: 400, timeMs: 1500 }`.

| Position                      | Legal moves | Iterations completed / requested | `stoppedBy`  | Wall-clock (search loop only) | % of `timeMs` cap |
| ----------------------------- | ----------- | -------------------------------- | ------------ | ----------------------------- | ----------------- |
| Opening land drop (T1 main)   | 3           | 400 / 400                        | `iterations` | 66.7 ms                       | 4.5%              |
| Rich main phase (25 moves)    | 25          | 400 / 400                        | `iterations` | 1392.9 ms                     | **92.9%**         |
| Combat declaration            | 4           | 400 / 400                        | `iterations` | 42.5 ms                       | 2.8%              |
| Instant-speed response window | 7           | 400 / 400                        | `iterations` | 166.5 ms                      | 11.1%             |
| Mulligan                      | —           | N/A (no search runs)             | —            | —                             | —                 |

Raw JSON (one run, this machine, under concurrent load from ~15 other
vitest/gate processes on the same host — see Caveats):

```json
{
    "medium": { "iterations": 400, "timeMs": 1500 },
    "results": [
        {
            "label": "opening land drop (T1 main)",
            "legalMoves": 3,
            "trace": {
                "iterationsCompleted": 400,
                "iterationsRequested": 400,
                "elapsedMs": 66.7,
                "stoppedBy": "iterations",
                "candidateCount": 3
            }
        },
        {
            "label": "rich main phase (many spells/targets)",
            "legalMoves": 25,
            "trace": {
                "iterationsCompleted": 400,
                "iterationsRequested": 400,
                "elapsedMs": 1392.9,
                "stoppedBy": "iterations",
                "candidateCount": 25
            }
        },
        {
            "label": "combat declaration",
            "legalMoves": 4,
            "trace": {
                "iterationsCompleted": 400,
                "iterationsRequested": 400,
                "elapsedMs": 42.5,
                "stoppedBy": "iterations",
                "candidateCount": 4
            }
        },
        {
            "label": "instant-speed response window",
            "legalMoves": 7,
            "trace": {
                "iterationsCompleted": 400,
                "iterationsRequested": 400,
                "elapsedMs": 166.5,
                "stoppedBy": "iterations",
                "candidateCount": 7
            }
        },
        {
            "label": "mulligan",
            "legalMoves": null,
            "trace": null,
            "note": "N/A by construction: runSearchWithTrace short-circuits state.phase === 'MULLIGAN' before the search loop (search.ts); the mulligan decision is decideMulligan() in brain.ts, not ISMCTS."
        }
    ]
}
```

## Caveats

- **Single run, 4 positions, one machine.** This is a spot-check, not a
  corpus (contrast `decision-telemetry.md`'s 2871-decision corpus). It
  answers "does the wall clock ever bind at `medium`, roughly?" — it does
  not bound the tail.
- **"~80-move main phase" was approximated at 25 legal moves.** Building a
  fixture that reaches 80 legal root moves needs a much larger hand/board
  than hand-assembled here; 25 was enough to be the busiest of the 4
  positions and to use 93% of the time budget, which is already the useful
  signal (closer to 80 legal moves, the wall clock is the more plausible
  binding constraint — this measurement is a lower bound on how often that
  happens, not an upper one).
- **Measured under heavy concurrent CPU load** — roughly 15 other
  vitest/gate processes were running on this machine at measurement time
  (shared dev box, multiple concurrent agent sessions). That is a
  pessimistic condition for wall-clock cost (contention can only slow a
  search down, not speed it up), so if anything this measurement
  UNDERSTATES how much iteration headroom `medium` has on an uncontended
  machine — and the 93%-of-budget result for the richest position is
  correspondingly a worse case than typical, not a best case.
- **Does not cover `hard`** (1200 iterations, 3000ms — issue #2682 also
  raised this to keep its pre-#2682 2× ratio to `medium`). A position rich
  enough to threaten `medium`'s 1500ms budget is very plausibly enough to
  threaten `hard`'s 3000ms one too, given `hard` runs 3× the iterations.
  Left for a follow-up measurement, not this ticket (out of scope per the
  issue: adaptive/early-stopping budgets are separate work).
- **Does not cover real client hardware** — a mid-tier phone's Worker thread
  is meaningfully slower than this dev machine's V8. The wall-clock
  constraint this document finds mostly slack on desktop-class hardware
  could bind far more often on the actual devices players use.

## Reproduce

1. `bun run worktree:init` (or an already-initialized worktree) with `bun run
dev` listening on some port — this measurement used `--port 5199`.
2. Save the harness script above (fill in the 4 fixtures — copy the pattern
   from `convex/gre/__tests__/search.bot.test.ts`'s `botMainPhase`/`creature`/
   `land`/`inHand` helpers, or from this ticket's PR description) to a `.mjs`
   file.
3. `bun <path-to-script>.mjs` from inside a worktree that has `playwright` in
   `node_modules` (a `worktree:init`'d checkout already does).
