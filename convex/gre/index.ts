// Shared GRE package surface (ADR 0001, issue #108 — vs-AI feasibility slice).
//
// The GRE in `convex/gre/` is already pure and isomorphic (no `convex/server`,
// `convex/values`, `_generated`, or `ctx.*` imports). This barrel is the
// SANCTIONED public surface through which the client-side AI brain imports the
// engine, deliberately and narrowly relaxing the documented boundary
// "frontend never imports `convex/gre/`" (see ADR 0001 § Consequences).
//
// Multiplayer keeps using the server GRE unchanged; the client GRE is used
// ONLY as the bot's thinking sandbox in vs-AI games — never authoritative.
//
// Keep this surface minimal and grow it per slice. Server/Convex code should
// keep importing the concrete modules directly; this barrel exists for the
// client crossing.

export type {
    GameState,
    PlayerState,
    CardInstanceState,
    StackItem,
} from "./state";
export type { Phase, Zone } from "./types";

// Structural-sharing clone for search (issue #108).
export { cloneGameState } from "./clone";

// Deterministic, seeded RNG — search must be reproducible given a seed.
export { nextRandom, randomInt, seededShuffle } from "./rng";

// Phase advancement — used by truncated rollouts to step the game forward.
export { advancePhase } from "./phases";

// Legal macro-move enumeration + mana tap planning (issue #110). The bot
// enumerates candidate moves from its own (projected) view and the executor
// replays the chosen one through existing mutations.
export { enumerateMoves, planManaPayment, MAX_COMBINATIONS } from "./moves";
export type { Move, ManaTap } from "./moves";

// Position heuristic + greedy 1-ply selection (issue #111). The bot scores each
// enumerated move one ply ahead and plays the best; `evaluate` is the leaf
// estimate that ISMCTS rollouts (issue #112) will reuse.
export { evaluate, WIN_SCORE } from "./evaluate";
export { applyMoveForSearch } from "./applyMove";
export { greedySelectMove } from "./greedy";

// ISMCTS + determinization — the searching Bot (issue #112). `search` replaces
// greedy selection: it re-determinizes hidden zones each iteration, descends a
// single information-set tree by UCB1, and runs truncated `evaluate`-scored
// rollouts. Reuses the real GRE for move application (no second simulator).
export { determinize } from "./determinize";
export { search, searchWithTrace, DEFAULT_BUDGET } from "./search";
export type { SearchBudget, DecisionTrace, CandidateTrace } from "./search";
export { makeRng } from "./rng";

// DecisionTrace debug view (AI reasoning logging). `searchWithTrace` returns,
// alongside the chosen move, a read-only record of every candidate the Brain
// weighed (visits / mean reward / per-term eval breakdown) so dumb moves like
// "cast Braingeyser on the human" can be diagnosed. Client-side only.
export { describeMove } from "./describeMove";
export { evaluateBreakdown } from "./evaluate";
export type { PositionBreakdown, EvalTerms } from "./evaluate";

// Pre-search responsiveness gate (issue #113). `shouldThink` decides whether a
// priority window is worth a full search; on a false the driver passes
// immediately through the existing auto-pass path so routine passes never stall.
export { shouldThink } from "./shouldThink";

// Difficulty presets (issue #114). One knob: each difficulty is just a
// `SearchBudget` for the same `search` — no separate bot logic. The lobby picks
// one and the client driver threads it through to the search.
export {
    DIFFICULTIES,
    DIFFICULTY_BUDGETS,
    DEFAULT_DIFFICULTY,
    budgetFor,
} from "./difficulty";
export type { Difficulty } from "./difficulty";
