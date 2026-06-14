// Client-side entry to the shared GRE package (ADR 0001, issue #108).
//
// This is the single sanctioned crossing of the "frontend never imports
// `convex/gre/`" boundary, narrowly relaxed for the vs-AI brain (ADR 0001).
// The AI brain — eventually running in a Web Worker — imports the real,
// server-identical engine from here so its internal simulations use one source
// of rules truth. The client GRE is a thinking sandbox only; the server stays
// authoritative for applying moves.
//
// All other frontend code MUST keep importing only public mutations/types, not
// the engine. New AI code should import from this module, not reach into
// `@convex/gre/*` directly.

export {
    cloneGameState,
    advancePhase,
    nextRandom,
    randomInt,
    seededShuffle,
} from "@convex/gre";

export type {
    GameState,
    PlayerState,
    CardInstanceState,
    StackItem,
    Phase,
    Zone,
} from "@convex/gre";
