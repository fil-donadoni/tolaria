# Informed vs. blind per-iteration search cost (issue #2790)

**Question.** `expert` (PRD #2787) feeds the search a real decklist for the
human seat via `deckKnowledge`, the same mechanism issue #2789 built for the
bot's own seat. The PRD's explicit risk: an "informed" iteration has a real
decklist to sample from (`unseenRemainder`, `convex/gre/determinize.ts`)
instead of a placeholder library, so it may cost more CPU per iteration than a
"blind" one. Under a wall-clock cap, a costlier iteration completes fewer
times in the same budget — so a naively-scaled `expert` preset could run
_fewer_ effective iterations than `hard` and end up weaker despite nominally
deeper search. This measures the actual ratio so the preset's margin is sized
from data, not a guess.

**Verdict.** On a representative mid-game decision (3-card hand, 4-permanent
opposing board, `p1` to act), running `searchWithTrace` with `minIterations`
forced to the full budget (disabling the #2685 early-stop so every run
completes exactly 1200 iterations) and a real 40-card preset deck
(`PRESET_DECKS[0]`) supplied as `deckKnowledge` for both seats vs. no
`deckKnowledge` at all, across three independent runs of 8 seeds each:

| Run | Blind ms/iter | Informed ms/iter | Ratio (informed/blind) |
| --- | ------------- | ---------------- | ---------------------- |
| 1   | 0.5750        | 0.5828           | 1.014                  |
| 2   | 0.5748        | 0.5596           | 0.974                  |
| 3   | 0.5719        | 0.5540           | 0.969                  |

The ratio sits within ±3% of 1.0 in every run — noise, not a measurable
per-node cost. `unseenRemainder`'s extra bookkeeping (filtering a real
decklist down to its unseen cards) is cheap relative to the rest of a
determinize + rollout pass. `expert.timeMs`/`expert.iterations` still carry a
+10% margin over `hard`'s (3000ms/1200 → 3300ms/1320,
`convex/gre/difficulty.ts`) rather than trusting the null result exactly,
since a real browser's per-iteration cost can differ from this dev-machine
measurement — the same caution `docs/research/iterations-per-decision.md`
(issue #2682) took for the general iteration/wall-clock question.

## Method

`convex/gre/search.ts`'s real `searchWithTrace`, in-process (no browser
needed — the cost being measured is CPU-bound search work, not the
browser-vs-Worker question issue #2682 already answered), each run forcing
`minIterations: budget.iterations` so `elapsedMs / iterationsCompleted` is a
clean per-iteration cost with no early-stop variance. `deckKnowledge` uses
`PRESET_DECKS[0]`'s real 40 card IDs (`convex/deckPresets.ts`) for both seats
in the "informed" condition, and is omitted entirely for "blind".

```ts
import { getCardByName } from "../convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../convex/cards/__tests__/setup";
import { searchWithTrace } from "../convex/gre/search";
import { PRESET_DECKS } from "../convex/deckPresets";

const deckCardIds = PRESET_DECKS[0].cards.map((c) => c.cardId);
const budget = (iterations: number) => ({
    iterations,
    minIterations: iterations,
});

function bench(deckKnowledge?: { playerId: string; cardIds: string[] }[]) {
    let totalMs = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { trace } = searchWithTrace(
            makePos(),
            "p1",
            budget(1200),
            seed,
            deckKnowledge
        );
        totalMs += trace?.elapsedMs ?? 0;
    }
    return totalMs / 8 / 1200;
}

const blind = bench(undefined);
const informed = bench([
    { playerId: "p1", cardIds: deckCardIds },
    { playerId: "p2", cardIds: deckCardIds },
]);
console.log({ blind, informed, ratio: informed / blind });
```

`makePos()` builds a fixed fixture: `p1` has a Hill Giant, 4 Mountains, and a
3-card hand (Lightning Bolt, Giant Growth, Ogre Warrior); `p2` has a Grizzly
Bears, a Craw Wurm and 2 Forests — a genuine multi-branch main-phase decision,
not a forced one-line tactic.

## Caveats

- **One dev machine, three runs.** A spot-check of the ORDER of magnitude
  (is the informed path 2x costlier? 10% costlier? indistinguishable?), not a
  tight confidence interval — consistent with the ±3% spread across runs.
- **In-process, not the browser Worker.** Issue #2682 already established
  that the browser-vs-native question is about wall-clock scheduling, not
  raw CPU cost per search node; this measurement isolates the latter.
- **One deck, one position.** A deck with more distinct unseen card names, or
  a position deeper in the game (smaller remaining library), could shift
  `unseenRemainder`'s cost; the `expert` preset's +10% margin over `hard` is
  the hedge against exactly that kind of drift, not a claim that 40 cards and
  this one position bound every deck/position combination.

## Reproduce

Save the script above (with `makePos()` filled in, or reuse
`convex/gre/__tests__/difficulty.bot.test.ts`'s `makeInstance`/`makePlayer`
helpers) and run it with `bun run <path>.ts` from a worktree with
`worktree:init` already applied.
