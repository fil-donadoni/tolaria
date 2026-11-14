// Turn Control (CR 723, ADR 0181) — one player makes another player's choices
// and decisions during that player's next turn.
//
// The rules never read this module. Only control of the PLAYER changes: every
// object keeps its controller and the controlled player is still the active
// player (CR 723.3), so casts, priority, combat and Pending Choices keep
// naming the controlled SEAT and spending that seat's resources (CR 723.5a).
// What changes is who ANSWERS for the seat, and that question is asked at the
// decision boundary — owed players, mutation authority, the viewer, the
// projection, Phase Stops, the Bot — through the three reads below.
//
// Pure, and typed against the two state fields it reads so the server
// `GameState`, the client's projected state and a `gameTicks` mirror all
// satisfy it directly.

import type {
    GameState,
    ScheduledExtraTurn,
    TurnControl,
} from "./state/declarations";

/** The slice of state the map reads. */
export type TurnControlView = { turnControls?: readonly TurnControl[] };

/** The player who answers for `seatId` right now: its controller while a Turn
 *  Control on that seat is active (CR 723.5), else the seat itself. A player
 *  given control of themselves (CR 723.9) maps to themselves. */
export function actingPlayerFor(view: TurnControlView, seatId: string): string {
    const active = view.turnControls?.find(
        (c) => c.active && c.controlledId === seatId
    );
    return active ? active.controllerId : seatId;
}

/** Every seat `playerId` answers for right now: their own unless another
 *  player controls it, plus each seat they actively control (CR 723.8 — a
 *  controller keeps making their own choices). Own seat first. */
export function seatsActedBy(
    view: TurnControlView,
    playerId: string
): string[] {
    const seats: string[] = [];
    if (actingPlayerFor(view, playerId) === playerId) seats.push(playerId);
    for (const c of view.turnControls ?? []) {
        if (!c.active || c.controllerId !== playerId) continue;
        if (!seats.includes(c.controlledId)) seats.push(c.controlledId);
    }
    return seats;
}

/** Whether another player currently makes `seatId`'s decisions. */
export function isControlledByAnother(
    view: TurnControlView,
    seatId: string
): boolean {
    return actingPlayerFor(view, seatId) !== seatId;
}

/** The ACTIVE entries only — what a mirror outside the fat state carries
 *  (`gameTicks.turnControls`), or `undefined` when there is none. */
export function activeTurnControls(
    view: TurnControlView
): TurnControl[] | undefined {
    const active = (view.turnControls ?? []).filter((c) => c.active);
    return active.length > 0 ? active : undefined;
}

/** CR 723.1 — `controllerId` gains control of `controlledId` during that
 *  player's next turn. CR 723.1a: player-controlling effects affecting the
 *  same player overwrite each other, the last one created working — so a
 *  PENDING entry for that player is replaced. An ACTIVE entry is left alone:
 *  it governs the turn in progress, and an effect created during it names the
 *  turn after. Mutates `state`. */
export function createTurnControl(
    state: GameState,
    controllerId: string,
    controlledId: string
): void {
    const kept = (state.turnControls ?? []).filter(
        (c) => c.active || c.controlledId !== controlledId
    );
    state.turnControls = [...kept, { controlledId, controllerId }];
}

/** CR 500.7 — schedule an extra turn for `playerId` directly after the next
 *  turn `afterNextTurnOf` actually takes. Mutates `state`. */
export function scheduleExtraTurn(
    state: GameState,
    playerId: string,
    afterNextTurnOf: string
): void {
    const entry: ScheduledExtraTurn = { playerId, afterNextTurnOf };
    state.scheduledExtraTurns = [...(state.scheduledExtraTurns ?? []), entry];
}

/** The outgoing turn is over. CR 723.1: a Turn Control "doesn't end until the
 *  beginning of the next turn" — every active entry ends here. CR 500.7: each
 *  extra turn scheduled after the turn that just ended is added now, directly
 *  after it. Idempotent, so the CR 614.10 skip recursion in `advanceTurn` may
 *  cross it twice. Mutates `state`. */
export function endTurnScopedControl(state: GameState): void {
    if (state.turnControls) {
        const pending = state.turnControls.filter((c) => !c.active);
        state.turnControls = pending.length > 0 ? pending : undefined;
    }
    if (state.scheduledExtraTurns) {
        const due = state.scheduledExtraTurns.filter((e) => e.armed);
        if (due.length > 0) {
            state.extraTurns = [
                ...(state.extraTurns ?? []),
                ...due.map((e) => e.playerId),
            ];
        }
        const waiting = state.scheduledExtraTurns.filter((e) => !e.armed);
        state.scheduledExtraTurns = waiting.length > 0 ? waiting : undefined;
    }
}

/** `activePlayerId` is actually taking this turn (called past the CR 614.10
 *  skip check, so a skipped turn consumes nothing — CR 723.1b). Their pending
 *  Turn Control becomes active for the entire turn (CR 723.1), and extra turns
 *  scheduled after their next turn are armed. Mutates `state`. */
export function beginTurnScopedControl(
    state: GameState,
    activePlayerId: string
): void {
    if (state.turnControls) {
        state.turnControls = state.turnControls.map((c) =>
            !c.active && c.controlledId === activePlayerId
                ? { ...c, active: true as const }
                : c
        );
    }
    if (state.scheduledExtraTurns) {
        state.scheduledExtraTurns = state.scheduledExtraTurns.map((e) =>
            !e.armed && e.afterNextTurnOf === activePlayerId
                ? { ...e, armed: true as const }
                : e
        );
    }
}
