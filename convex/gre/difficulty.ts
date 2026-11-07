// vs-AI difficulty presets (ADR 0001, issue #114).
//
// Difficulty is ONE KNOB: each preset is just a `SearchBudget` handed to the
// same `search(state, playerId, budget, seed)`. There is no separate "dumb bot"
// code path — a weaker bot simply searches fewer iterations / less time, so it
// explores a shallower slice of the same tree and more often misses the line a
// deeper search finds. This keeps the engine single-sourced (criterion: presets
// differ only by budget, not by logic) and the server move path untouched (the
// budget is a client-side search knob only).
//
// Budgets carry plain numbers only (`iterations` / `timeMs`) so a preset is
// structurally cloneable — it crosses the Worker boundary via `postMessage`. The
// injectable `now` clock on `SearchBudget` is for deterministic tests and is
// never part of a preset.

import type { SearchBudget } from "./search";

/** The difficulty levels exposed in the lobby. `expert` is issue #2790,
 *  PRD #2787 — an ADDITIONAL level above `hard`, never a re-point of it: making
 *  `hard` informed would silently change the opponent a player has calibrated
 *  against and delete "thinks deeply but blind" from the ladder of options. */
export type Difficulty = "medium" | "hard" | "expert";

/** Ordered weakest → strongest, for rendering a selector and for tests that
 *  assert monotonic strength. */
export const DIFFICULTIES: readonly Difficulty[] = [
    "medium",
    "hard",
    "expert",
] as const;

/** Search budget per difficulty. Strictly increasing search effort — and
 *  nothing else — separates the presets. `medium` matches the historical
 *  `DEFAULT_BUDGET` (`{ iterations: 400, timeMs: 1500 }`, ADR 0015's ~1.5s
 *  ceiling for a full-round rollout), so its iterations complete against
 *  the wall clock in a real game.
 *
 *  `hard.timeMs` is twice `medium.timeMs`, so `hard` stays proportionally the
 *  deepest blind search: `1500 * 2 = 3000`. Monotonicity (1500 < 3000 < 3300) is asserted in
 *  `difficulty.bot.test.ts`.
 *
 *  `medium` and `hard` both read clean tactics perfectly; `hard`'s extra budget
 *  tells in deeper midgame positions.
 *
 *  EARLY STOP: no preset needs a `minIterations` field — the
 *  settle rule defaults to active (`minIterations` unset ⇒ 0) and stops a
 *  search early only once the root pick is provably settled. That is what
 *  makes an obvious decision cost ~0s while a contested one still runs to the
 *  ceiling, without any preset change. `medium.timeMs` STAYS 1500: raising it
 *  (e.g. to 3000) is licensed only by a ladder verdict showing the extra
 *  iterations pay on rich decisions at the same iteration budget, which does
 *  not exist yet.
 *
 *  `expert` (issue #2790, PRD #2787) amends the module's own criterion: a
 *  preset now carries a budget AND an opponent-knowledge mode
 *  (`DIFFICULTY_KNOWS_OPPONENT` below) — `expert` is the one level that feeds
 *  the search the human seat's real decklist (`deckKnowledge.ts`), so the
 *  Brain stops imagining an opponent who has surrendered.
 *
 *  Its budget is set from a MEASURED per-iteration cost, not a guess (the
 *  PRD's explicit risk: a simulated opponent holding real cards has real
 *  moves to enumerate, so each informed iteration costs more, and under a
 *  wall-clock cap a more expensive iteration means fewer completed — the
 *  level must not end up weaker than `hard` despite nominally deeper search).
 *  Measured in `docs/research/expert-informed-iteration-cost.md`: forcing the
 *  full iteration count via `minIterations` on a representative branching
 *  mid-game decision, across three 8-seed runs, the informed/blind
 *  per-iteration ratio landed within ±3% of 1.0 — the added
 *  `unseenRemainder` bookkeeping is within noise, not a measurable per-node
 *  cost. `expert.timeMs` still carries a +10% margin over `hard.timeMs`
 *  (3000 → 3300) rather than trusting the null result exactly, since a real
 *  browser's per-iteration cost can differ from this dev-machine benchmark;
 *  `iterations` gets the same +10% (1200 → 1320) so the preset stays the
 *  strictly deepest of them all when time is not the binding constraint,
 *  preserving the monotonic-budget pattern the other presets already
 *  assert. Both stay well under `BRAIN_CONSULT_TIMEOUT_MS` (5000ms,
 *  `src/lib/ai/brain-client.ts`). */
export const DIFFICULTY_BUDGETS: Record<Difficulty, SearchBudget> = {
    medium: { iterations: 400, timeMs: 1500 },
    hard: { iterations: 1200, timeMs: 3000 },
    expert: { iterations: 1320, timeMs: 3300 },
};

/** Which presets feed the search the human seat's real decklist as opponent
 *  knowledge (issue #2790, PRD #2787) — the second axis the module's
 *  criterion now names alongside the budget. Absence from
 *  `DeckKnowledgeBySeat` is the engine's own fail-closed discriminator
 *  (`convex/gre/deckKnowledge.ts`), so `medium`/`hard` stay on the
 *  blind path unchanged: this record is consulted ONLY by the client driver
 *  that assembles the knowledge map, never by the search itself. */
export const DIFFICULTY_KNOWS_OPPONENT: Record<Difficulty, boolean> = {
    medium: false,
    hard: false,
    expert: true,
};

/** Sensible default when the player has not chosen yet. */
export const DEFAULT_DIFFICULTY: Difficulty = "expert";

/** Map a difficulty to its search budget, falling back to the default preset
 *  for any unrecognised value (e.g. a stale persisted string). */
export function budgetFor(difficulty: string | null | undefined): SearchBudget {
    if (difficulty && difficulty in DIFFICULTY_BUDGETS) {
        return DIFFICULTY_BUDGETS[difficulty as Difficulty];
    }
    return DIFFICULTY_BUDGETS[DEFAULT_DIFFICULTY];
}

/** Does this difficulty feed the search the human seat's real decklist?
 *  Falls back to the default preset for any unrecognised value, exactly like
 *  {@link budgetFor}. */
export function knowsOpponent(difficulty: string | null | undefined): boolean {
    if (difficulty && difficulty in DIFFICULTY_KNOWS_OPPONENT) {
        return DIFFICULTY_KNOWS_OPPONENT[difficulty as Difficulty];
    }
    return DIFFICULTY_KNOWS_OPPONENT[DEFAULT_DIFFICULTY];
}
