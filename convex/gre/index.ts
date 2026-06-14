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
