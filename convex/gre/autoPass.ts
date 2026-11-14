// Phase Stops, server side (ADR 0077). A Phase Stop preference says "do not
// stop me in this step"; the drain (`drainAutoPasses`, `gre/phases.ts`) takes
// the pass for a seat that asked, so a run of skipped steps costs one
// mutation instead of one round-trip per step.
//
// A Phase Stop is STRICT where a Pass Turn is permissive: it passes only an
// empty-stack priority window with nothing else owed, and never resolves,
// confirms or declares anything on the seat's behalf.

import { computeExpectedInput } from "./expectedInput";
import { actingPlayerFor } from "./turnControl";
import type { GameState } from "./state";
import { isPhaseSkipped, isSkippablePhase, type Side } from "../phaseStopPrefs";

/** True unless `playerId` sits in a plain priority window a Phase Stop may
 *  pass: the Expected Input (ADR 0047) is their priority, the stack is empty
 *  (never skip a response window, CR 117.3), and no turn-based declaration or
 *  payment is open. `computeExpectedInput` reports unconfirmed attackers and
 *  an open damage step as a priority window, so both are refused here. */
export function autoPassBlocked(state: GameState, playerId: string): boolean {
    const expected = computeExpectedInput(state);
    if (expected?.kind !== "priority") return true;
    if (expected.playerId !== playerId) return true;
    if (state.stack.length > 0) return true;
    // CR 508.1 — attackers not yet declared.
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        state.combat &&
        !state.combat.confirmed
    )
        return true;
    // CR 510.1 — combat damage not yet assigned.
    if (
        (state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE") &&
        state.combat &&
        state.combat.damageConfirmed === false
    )
        return true;
    // CR 601.2 / 602.2 — a cast or activation is mid-announcement.
    if (state.pendingCast || state.pendingActivation) return true;
    return false;
}

/** Whether the drain takes this window for `playerId` as a Phase Stop skip.
 *  Reads the seat's preferences off the transient `state.seatSkipPrefs`; a
 *  seat with none hydrated is never skipped (ADR 0077 §5). */
export function phaseStopSkips(state: GameState, playerId: string): boolean {
    // CR 723.5 (ADR 0181) — skipping a window is a decision, so a controlled
    // seat's windows are skipped by the preferences of the player who answers
    // for it, never by the controlled user's own.
    const actingId = actingPlayerFor(state, playerId);
    const prefs = state.seatSkipPrefs?.[actingId];
    if (!prefs) return false;
    if (!isSkippablePhase(state.phase)) return false;
    if (autoPassBlocked(state, playerId)) return false;
    // The side stays the SEAT's: a controlled turn is played with the Acting
    // Player's own-turn stops, their own windows in it with their
    // opponent-turn ones.
    const side: Side = playerId === state.activePlayerId ? "self" : "opponent";
    return isPhaseSkipped(prefs, state.phase, side);
}
