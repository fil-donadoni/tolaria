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
    PendingChoice,
    PendingChoiceKind,
} from "./state";
export { getPendingChoiceMin, getPendingChoiceMax } from "./state";
export { normalizeManaCost, isManaCostCovered } from "./state";
export { normalizeMayPayCost, canPayMayPayCost } from "./state";
export { getPlayer, matchesPermanentFilter } from "./state";
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

// Choice-node coverage predicate (PRD #1423, issue #1506). THE single authority
// on "is this pending-choice kind an in-tree ISMCTS decision node?" — the same
// registry `enumerateMoves` / `decidingPlayer` consult. Exported so the client
// bot gate (`buildOwedChoice` → `decideBotAction`) can route a generator-covered
// root choice to the search instead of answering it with the ADR 0016 heuristic.
export {
    hasChoiceCandidateGenerator,
    isSearchableChoiceNode,
} from "./ai/choiceCandidates";

// Expected-Input-driven legal action enumeration (ADR 0047, issue #801). The
// gate's dual: yields the concrete action set for the acting player, derived
// from the same contract every game mutation is gated through. Pure — usable
// by client-side bot move generation and by server code alike.
export { legalActions, gateRequestFor } from "./legalActions";
export type {
    LegalAction,
    PriorityAction,
    PriorityMove,
    ChoiceAction,
    TargetAction,
    BlockersAction,
} from "./legalActions";
export {
    assertExpectedInput,
    computeExpectedInput,
    computeOwedPlayerIds,
    EXPECTED_INPUT_KINDS,
} from "./expectedInput";
export type { ExpectedInputKind, GateRequest } from "./expectedInput";

// Position heuristic + greedy 1-ply selection (issue #111). The bot scores each
// enumerated move one ply ahead and plays the best; `evaluate` is the leaf
// estimate that ISMCTS rollouts (issue #112) will reuse.
export { evaluate, WIN_SCORE, cardValueById, materialMargin } from "./evaluate";
export { applyMoveForSearch } from "./applyMove";
export { greedySelectMove } from "./greedy";

// Headless game setup (shared by the create/join mutations and the self-play
// harness) — pure initial-state assembly from two deck inputs, seeded.
export {
    createInitialGameState,
    buildPlayerState,
    STARTING_HAND_SIZE,
} from "./setup";
export type { PlayerInput, DeckInput } from "./setup";

// Engine-side resolution-choice resolvers (drive the SAME primitives as the
// submit mutations) — used by the self-play harness to apply the bot's
// mid-resolution picks (discard / scry / sacrifice / may-pay) headless.
export {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyLandEntrySubmit,
    applyNameCardSubmit,
} from "./pendingChoiceSubmit";
export type {
    SubmitChoiceArgs,
    SubmitMayPayArgs,
    SubmitLandEntryArgs,
    SubmitNameCardArgs,
} from "./pendingChoiceSubmit";
export { recordDeclaration } from "./mulligan";

// ISMCTS + determinization — the searching Bot (issue #112). `search` replaces
// greedy selection: it re-determinizes hidden zones each iteration, descends a
// single information-set tree by UCB1, and runs truncated `evaluate`-scored
// rollouts. Reuses the real GRE for move application (no second simulator).
export { determinize } from "./determinize";
export {
    search,
    searchWithTrace,
    applyMoveInSearch,
    decidingPlayer,
    DEFAULT_BUDGET,
    REWARD_PER_MARGIN_POINT,
} from "./search";
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

// Opaque library-placeholder sentinel (issue #136). The client adapter rebuilds
// hidden libraries with instances carrying this id so the search can simulate
// draws without phantom deck-outs; the engine treats it as a no-action card.
export { PLACEHOLDER_CARD_ID } from "./constants";

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
