// Manual phase stepping (manual-mode QA round 3, item 5).
//
// A Manual Game's phase is a FREE marker (ADR 0080): nothing consults it for
// legality, it only records where the two players agreed they are in the turn.
// Until now nothing could MOVE it either — `manualSetPhase` existed as a
// mutation with no caller, so the board sat on `PRECOMBAT_MAIN` all game.
//
// This module is the whole stepping rule: given the current marker, what is
// the next one. `MANUAL_PHASE_ORDER` (`convex/manual.ts`) is the single
// authority on the sequence — the same array `manualEndTurn` resets to the
// head of.
//
// Pure: no Convex, no React, no DOM.

import { MANUAL_PHASE_ORDER, type ManualPhase } from "@convex/manual";

/** The phase a fresh / unrecognised marker reads as, matching
 *  `manualPhase`'s fallback in `manual-game-context.ts` — a Manual Game that
 *  has never set the marker is, by that convention, in the precombat main
 *  phase, so the first Space must go to the phase AFTER it, not to `UNTAP`. */
const DEFAULT_MANUAL_PHASE: ManualPhase = "PRECOMBAT_MAIN";

/**
 * The next phase marker after `current`, wrapping `CLEANUP` → `UNTAP`.
 *
 * Wrapping rather than stopping is deliberate: ending the turn is a SEPARATE
 * verb (Enter → `manualEndTurn`, which is what moves the turn number and the
 * active player). Space is only ever "we've moved on within this turn", so it
 * must never silently hand the turn over — a player who Spaces past cleanup
 * has simply gone round again, which at a table is a shrug, not a state
 * change they can't undo.
 */
export function nextManualPhase(current: string | undefined): ManualPhase {
    const index = MANUAL_PHASE_ORDER.indexOf(
        (current ?? DEFAULT_MANUAL_PHASE) as ManualPhase
    );
    // An unrecognised marker resolves as the default, so its "next" is the
    // one after the default — never index 0, which would read as the Space
    // key rewinding the turn.
    const from =
        index === -1 ? MANUAL_PHASE_ORDER.indexOf(DEFAULT_MANUAL_PHASE) : index;
    return MANUAL_PHASE_ORDER[(from + 1) % MANUAL_PHASE_ORDER.length];
}
