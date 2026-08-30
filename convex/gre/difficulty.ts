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

/** The difficulty levels exposed in the lobby. */
export type Difficulty = "easy" | "medium" | "hard";

/** Ordered weakest → strongest, for rendering a selector and for tests that
 *  assert monotonic strength. */
export const DIFFICULTIES: readonly Difficulty[] = [
    "easy",
    "medium",
    "hard",
] as const;

/** Search budget per difficulty. Strictly increasing search effort — and
 *  nothing else — separates the presets. `medium` matches the historical
 *  `DEFAULT_BUDGET` (`{ iterations: 400, timeMs: 1500 }`, ADR 0015's ~1.5s
 *  ceiling for a full-round rollout), so the default-difficulty bot is
 *  exactly as strong as before this slice. Issue #2682 is what fixed this:
 *  before it, `medium.timeMs` was 300 — a stale value nobody had re-derived
 *  against the ADR 0015 rollout, and iterations never actually completed
 *  against the wall clock in a real game (only the untimed blade suite ran
 *  the full 400).
 *
 *  `hard.timeMs` keeps its PRE-#2682 ratio to `medium.timeMs` — 600 / 300 =
 *  2× — rather than being bumped by the same +1200ms delta medium got, so
 *  `hard` stays proportionally the deepest search of the three:
 *  `1500 * 2 = 3000`. `easy.timeMs` is untouched (#2682 only re-scales
 *  `medium`/`hard`; `easy`'s 120ms was never claimed to match anything).
 *  Monotonicity (120 < 1500 < 3000) is asserted in `difficulty.bot.test.ts`.
 *
 *  `easy` is deliberately SHALLOW: a handful of iterations explores so little of
 *  the tree that the bot misses lines a deeper search finds (it even misreads
 *  some forced tactics), making it genuinely beatable. `medium` and `hard` both
 *  read clean tactics perfectly; `hard`'s extra budget tells in deeper midgame
 *  positions. The strength gradient is verified in `difficulty.test.ts`.
 *
 *  EARLY STOP (issue #2685): no preset needs a `minIterations` field — the
 *  settle rule defaults to active (`minIterations` unset ⇒ 0) and stops a
 *  search early only once the root pick is provably settled. That is what
 *  makes an obvious decision cost ~0s while a contested one still runs to the
 *  ceiling, without any preset change. `medium.timeMs` STAYS 1500: raising it
 *  (e.g. to 3000) is licensed only by a ladder verdict showing the extra
 *  iterations pay on rich decisions at the same iteration budget, which does
 *  not exist yet. */
export const DIFFICULTY_BUDGETS: Record<Difficulty, SearchBudget> = {
    easy: { iterations: 3, timeMs: 120 },
    medium: { iterations: 400, timeMs: 1500 },
    hard: { iterations: 1200, timeMs: 3000 },
};

/** Sensible default when the player has not chosen yet. */
export const DEFAULT_DIFFICULTY: Difficulty = "medium";

/** Map a difficulty to its search budget, falling back to the default preset
 *  for any unrecognised value (e.g. a stale persisted string). */
export function budgetFor(difficulty: string | null | undefined): SearchBudget {
    if (difficulty && difficulty in DIFFICULTY_BUDGETS) {
        return DIFFICULTY_BUDGETS[difficulty as Difficulty];
    }
    return DIFFICULTY_BUDGETS[DEFAULT_DIFFICULTY];
}
