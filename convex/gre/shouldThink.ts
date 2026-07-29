// Pre-search responsiveness gate for the vs-AI Bot (ADR 0001, issue #113).
//
// A full ISMCTS `search` is not free: it costs a Worker round-trip and a
// bounded slice of wall-clock. Yet the vast majority of priority windows the
// bot sees are trivial — an empty stack with nothing to do but pass.
// `shouldThink(state, playerId)` is the cheap, pure pre-filter that answers
// "is this window worth searching?". When it returns false the driver passes
// IMMEDIATELY through the existing pass-priority / auto-pass path, so routine
// passes never stall the game and the UI keeps moving.
//
// A window is worth searching when the bot has a real (non-pass) move AND the
// window is one where acting matters:
//   * its own main phase            → lands / spells / abilities to weigh;
//   * a combat declaration window   → attackers / blockers to choose;
//   * a non-empty stack             → a relevant instant-speed response.
// An empty-stack priority window on someone else's turn (or the bot's own
// non-main steps) is a hold-up window: the bot passes without searching, rather
// than burning a search to cast nothing.
//
// PURE: reads state, never mutates; identical inputs always give the same
// answer. Reuses `decidingPlayer` (the exact window gating `search` uses) and
// `enumerateMoves` (the single source of legal moves) so this gate can never
// disagree with the search about whose window it is or what is playable.

import type { GameState } from "./state";
import { decidingPlayer } from "./search";
import { enumerateMoves } from "./moves";

/** Phases where the bot has plays of its own to consider when it is active. */
const MAIN_PHASES = new Set(["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"]);

/** Combat declaration windows are inherently real decisions (which creatures
 *  attack / block), so they are always worth a search. */
const COMBAT_DECLARATION_PHASES = new Set([
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
]);

/** Whether the bot's current decision window is worth a full ISMCTS search.
 *  False on trivial passes (only `pass` is legal, or an empty-stack hold-up
 *  window); true on main-phase, combat-declaration and relevant-instant
 *  windows. Pure. */
export function shouldThink(state: GameState, playerId: string): boolean {
    // Not the bot's window at all — nothing to think about.
    if (decidingPlayer(state) !== playerId) return false;

    // Only a bare pass is available → nothing to deliberate over.
    const moves = enumerateMoves(state, playerId, {
        pruneDominatedNoOps: true,
    });
    if (!moves.some((m) => m.kind !== "pass")) return false;

    // Mulligan keep/mull and combat declarations are always real decisions.
    if (state.phase === "MULLIGAN") return true;
    if (COMBAT_DECLARATION_PHASES.has(state.phase)) return true;

    // The bot's own main phase: a non-pass move means a play worth weighing.
    if (MAIN_PHASES.has(state.phase) && state.activePlayerId === playerId) {
        return true;
    }

    // Any other priority window is only worth searching as a response to
    // something already on the stack (a relevant instant). Empty stack → pass.
    return state.stack.length > 0;
}
