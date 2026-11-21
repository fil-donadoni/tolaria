// vs-AI difficulty presets (ADR 0000, issue #114).
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

/** The difficulty presets. Only the levels {@link DIFFICULTY_OFFERED} switches
 *  on are played (issue #10113). */
export type Difficulty = "medium" | "hard" | "expert";

/** Ordered weakest → strongest, for tests that assert monotonic strength. */
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
 *  deeper search: `1500 * 2 = 3000`. Monotonicity (1500 < 3000 < 8300) is asserted in
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
 *  (`DIFFICULTY_KNOWS_OPPONENT` below) — a knowing level feeds the search the
 *  human seat's real decklist (`deckKnowledge.ts`), so the Brain stops
 *  imagining an opponent who has surrendered.
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
 *  assert.
 *
 *  `expert.timeMs` 8300 (issue #10029) is sized to the owner's quality
 *  target — 400 iterations per search on every engine family (ruling in
 *  issue #10027, `docs/research/expert-think-longer.md` § 5) — from the
 *  field reading after the engine changes (issue #10028,
 *  `docs/research/field-reading-after-engine-changes.md` § 1), where 99% of
 *  searches stopped on the 3300 ms cap: Chromium 387 iterations per search
 *  (117/s), iPhone 309 (94/s), desktop WebKit 160 (48/s), Gecko 94 (28/s).
 *  400 on Gecko would take ~14 s; the owner ruled the compromise (2026-11-21)
 *  at the cap that brings desktop WebKit to 400 (400 / 48.5 per s ≈ 8.25 s),
 *  leaving Gecko at ~235 for the engine work to close. `iterations` stays
 *  1320 (≥ 400): a fast machine stops on the count, not the clock.
 *  `BRAIN_CONSULT_TIMEOUT_MS` and `BOT_WATCHDOG_MS` are DERIVED from
 *  {@link HARDEST_SEARCH_TIME_MS} (issue #10115), so raising a cap here
 *  carries the client's timeout chain with it. */
export const DIFFICULTY_BUDGETS: Record<Difficulty, SearchBudget> = {
    medium: { iterations: 400, timeMs: 1500 },
    hard: { iterations: 1200, timeMs: 3000 },
    expert: { iterations: 1320, timeMs: 8300 },
};

/** The longest wall-clock cap any preset grants one search (issue #10115):
 *  the max over every preset, not a named one, so a harder level re-derives
 *  it. The floor of the client's timeout chain — `BRAIN_CONSULT_TIMEOUT_MS`
 *  (`src/lib/ai/consult-timeout.ts`) adds its named margins to it, and
 *  `BOT_WATCHDOG_MS` (`src/hooks/useVsAiDriver.ts`) adds its own on top. */
export const HARDEST_SEARCH_TIME_MS: number = Math.max(
    ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.timeMs ?? 0)
);

/** Which presets feed the search the human seat's real decklist as opponent
 *  knowledge (issue #2790, PRD #2787) — the second axis the module's
 *  criterion now names alongside the budget. Absence from
 *  `DeckKnowledgeBySeat` is the engine's own fail-closed discriminator
 *  (`convex/gre/deckKnowledge.ts`), so a `false` here keeps a level on the blind
 *  path: this record is consulted ONLY by the client driver that assembles the
 *  knowledge map, never by the search itself. For now every level knows, and
 *  the setup surfaces say so unconditionally (`BOT_KNOWS_DECKLIST_LINE`,
 *  `src/lib/difficultyLabels.ts`): flipping a row owes that line a condition. */
export const DIFFICULTY_KNOWS_OPPONENT: Record<Difficulty, boolean> = {
    medium: true,
    hard: true,
    expert: true,
};

/** Sensible default when the player has not chosen yet. */
export const DEFAULT_DIFFICULTY: Difficulty = "expert";

/** Which presets a game may play at (issue #10113). Levels are switched off,
 *  not deleted: below `expert` the Bot is not worth playing, and in the field
 *  `hard` (3000 ms) was `expert` (then 3300 ms) minus 9%, indistinguishable
 *  (owner ruling, issue #10027). No surface offers a choice, and a game stored at a
 *  level switched off plays at {@link DEFAULT_DIFFICULTY}. The levels may come
 *  back once they differ in the field: flipping a row back on owes the lobby a
 *  selector again. */
export const DIFFICULTY_OFFERED: Record<Difficulty, boolean> = {
    medium: false,
    hard: false,
    expert: true,
};

/** Is this value a level a game may play at? The parsers of a stored or
 *  persisted choice accept only these. */
export function isOfferedDifficulty(value: unknown): value is Difficulty {
    return (
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(DIFFICULTY_OFFERED, value) &&
        DIFFICULTY_OFFERED[value as Difficulty]
    );
}

/** The level a game stored at `difficulty` actually plays at: itself when it
 *  is offered, else the default preset — a level switched off, the retired
 *  `easy`, or any unrecognised value (e.g. a stale persisted string). */
export function playedDifficulty(
    difficulty: string | null | undefined
): Difficulty {
    return isOfferedDifficulty(difficulty) ? difficulty : DEFAULT_DIFFICULTY;
}

/** Map a difficulty to the search budget of the level it plays at
 *  ({@link playedDifficulty}). */
export function budgetFor(difficulty: string | null | undefined): SearchBudget {
    return DIFFICULTY_BUDGETS[playedDifficulty(difficulty)];
}

/** Does this difficulty feed the search the human seat's real decklist?
 *  Resolved through {@link playedDifficulty}, exactly like {@link budgetFor}. */
export function knowsOpponent(difficulty: string | null | undefined): boolean {
    return DIFFICULTY_KNOWS_OPPONENT[playedDifficulty(difficulty)];
}
