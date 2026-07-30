// Control continuity — "a permanent they have controlled since the beginning
// of the turn" (Keldon Twilight, PLS; the same continuity window CR 302.6
// describes for summoning sickness, but anchored to the CURRENT turn rather
// than to the controller's most recent untap step).
//
// A permanent qualifies for a player only if BOTH hold for the whole turn so
// far:
//   * it was already on the battlefield when the turn began — read off the
//     `enteredOnTurn` entry stamp (`markEnteredThisTurn`, CR 400.7). A
//     permanent that left and came back this turn is a NEW object with a fresh
//     stamp (`resetBattlefieldTransientState`), so it correctly fails here;
//   * its controller has not changed during the turn — recorded in the
//     turn-scoped `GameState.controlChangedThisTurn` ledger.
//
// Why a LEDGER of breaks and not a snapshot of who-controlled-what at turn
// start: control can change mid-turn and change BACK (Ray of Command expiring,
// a Control Magic dying), and a start-of-turn snapshot compared against the
// live controller reads that round trip as unbroken continuity. Recording the
// break at the moment it happens is the only shape that survives it, and it is
// also the cheaper state (only the ids that actually moved). It cannot be
// reconstructed after the fact, which is why it is persisted.
//
// Deliberately NOT `isSummoningSick`: that flag is cleared at its CONTROLLER's
// untap step, so it stays true across the whole of the opponent's following
// turn — a permanent its controller has genuinely held since that turn began
// would read as "not continuously controlled" for the opponent's entire turn.

import type { CardInstanceState, GameState } from "./state";

/** The two turn-scoped `GameState` fields control continuity is derived from.
 *  Both cross the wire verbatim (`projectPublicState` spreads `...state`), so
 *  client call sites can build this view straight from the projected state. */
export type ControlContinuityView = Pick<
    GameState,
    "turn" | "controlChangedThisTurn"
>;

/** Records that `instanceId`'s controller changed during the current turn, so
 *  neither the old nor the new controller has controlled it continuously since
 *  the turn began. Called from every site that actually moves a permanent
 *  between battlefields (`applyControlChange` and its reverse
 *  `revertControlChange`) — both directions break continuity, so both record.
 *  Idempotent: a permanent whose control changes twice in a turn is listed
 *  once. */
export function recordControlChangeThisTurn(
    state: GameState,
    instanceId: string
): void {
    const ledger = state.controlChangedThisTurn ?? [];
    if (ledger.includes(instanceId)) return;
    state.controlChangedThisTurn = [...ledger, instanceId];
}

/** Clears the ledger at a turn boundary (`advanceTurn`, phases.ts) — the
 *  continuity window restarts with each turn. Mirrors the other per-turn
 *  tallies reset there (`deathsThisTurn`, `spellsCastThisTurn`). */
export function resetControlContinuity(state: GameState): void {
    state.controlChangedThisTurn = undefined;
}

/** True iff the permanent's CURRENT controller has controlled it continuously
 *  since the beginning of the current turn. Callers pass a card found on some
 *  player's battlefield, so the "do they control it right now" half is already
 *  established by the caller; this answers only the continuity half.
 *
 *  Both parameters are structurally typed so the CLIENT can call this exact
 *  function (ADR 0074 — the frontend may import pure engine modules): the two
 *  fields it reads, `GameState.turn` and `GameState.controlChangedThisTurn`,
 *  both cross the wire verbatim, as does `CardInstanceState.enteredOnTurn`.
 *  One authority, so the board's clickability highlight and the server's
 *  submit validation can never disagree. */
export function hasControlledSinceTurnStart(
    state: ControlContinuityView,
    card: Pick<CardInstanceState, "id" | "enteredOnTurn">
): boolean {
    // CR 400.7 — entered (or re-entered) during this turn: the object has not
    // existed on the battlefield since the turn began.
    if (card.enteredOnTurn !== undefined && card.enteredOnTurn >= state.turn) {
        return false;
    }
    return !(state.controlChangedThisTurn ?? []).includes(card.id);
}
