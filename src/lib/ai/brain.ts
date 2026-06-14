// The AI Bot's Brain — the pure decision function (ADR 0001, issue #109).
//
// This is the end-to-end spine's "intelligence": the dumbest possible bot, one
// that takes the NULL action in every window it owns. It keeps its opening
// hand, declares no attackers, declares no blockers, and passes priority — so a
// full game can be played to completion against it. Later slices replace the
// body with real search (greedy → ISMCTS) while this signature and the
// surrounding driver/executor stay put.
//
// PURE and Worker-free: the Worker (`brain.worker.ts`) is a thin shell that
// calls this; all tests exercise this function directly with no browser.
//
// Issue #110 grows the bot from pass-only to random-legal: the Worker
// enumerates the full legal move set (`enumerateMoves`) from the bot's own
// projected view and `selectMove` picks one uniformly at random. `BotView` /
// `decideBotAction` remain as the cheap main-thread gate that decides whether
// the bot owes any action at all before paying for a Worker round-trip.

import type { Move } from "@convex/gre";

/** The minimal slice of game state the bot needs to decide. Built on the
 *  driving client from the full state (the bot's hand is visible to the human's
 *  process — accepted, vs-AI is single-player; see ADR 0001). For the pass-only
 *  bot only the current decision WINDOW matters, not card contents. */
export type BotView = {
    /** The seat the bot controls (`${userId}-p2`). */
    botId: string;
    phase: string;
    priorityPlayerId: string;
    activePlayerId: string;
    /** Whether a combat is in progress and its declaration flags. */
    hasCombat: boolean;
    attackersConfirmed: boolean;
    blockersConfirmed: boolean;
    /** Mulligan declaration window (pre-game). */
    mulliganDeclaringId?: string;
    /** True while a player is bottoming cards after a mulligan — not a keep
     *  decision window. The pass-only bot always keeps, so it never bottoms. */
    mulliganBottoming?: boolean;
    /** True once the game has ended — the bot must not act. */
    gameOver?: boolean;
};

/** A bot decision, realised by the executor through EXISTING mutations only
 *  (no new move surface — issue #109 / ADR 0001):
 *   - `keep`              → `declareMulligan({ decision: "keep" })`
 *   - `declare-attackers` → `confirmAttackers` (empty selection = no attack)
 *   - `declare-blockers`  → `confirmBlockers` (empty selection = no block)
 *   - `pass`              → `passPriority`
 *   - `none`              → the bot owes no action right now; do nothing. */
export type BotAction = {
    kind: "keep" | "declare-attackers" | "declare-blockers" | "pass" | "none";
};

const NONE: BotAction = { kind: "none" };

/** Decide the bot's action for the current window. Returns `none` when it is not
 *  the bot's turn to act. Deterministic and side-effect free. */
export function decideBotAction(view: BotView): BotAction {
    if (view.gameOver) return NONE;

    // Pre-game: keep the opening hand the moment it is the bot's declaration.
    if (view.phase === "MULLIGAN") {
        if (view.mulliganBottoming) return NONE;
        if (view.mulliganDeclaringId === view.botId) return { kind: "keep" };
        return NONE;
    }

    // Combat declarations are gated before priority can pass (the server
    // rejects passPriority until they are confirmed), so handle them first.
    if (
        view.phase === "DECLARE_ATTACKERS" &&
        view.hasCombat &&
        !view.attackersConfirmed &&
        view.activePlayerId === view.botId
    ) {
        return { kind: "declare-attackers" };
    }
    if (
        view.phase === "DECLARE_BLOCKERS" &&
        view.hasCombat &&
        !view.blockersConfirmed &&
        view.activePlayerId !== view.botId
    ) {
        // Defender is the non-active player; in a 2-player game that is the bot
        // whenever the human is active.
        return { kind: "declare-blockers" };
    }

    // Ordinary priority window.
    if (view.priorityPlayerId === view.botId) return { kind: "pass" };

    return NONE;
}

/** Pick one move uniformly at random from the enumerated legal set. `rand` must
 *  be in [0, 1) (e.g. `Math.random()`); kept as a parameter so the choice is a
 *  pure, testable function. Returns null for an empty set (bot owes nothing). */
export function selectMove(moves: Move[], rand: number): Move | null {
    if (moves.length === 0) return null;
    const index = Math.min(moves.length - 1, Math.floor(rand * moves.length));
    return moves[index];
}
