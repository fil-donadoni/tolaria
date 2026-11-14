// Turn Control on the client (CR 723, ADR 0181).
//
// A controller's board needs nothing special: it follows the controlled seat
// (`computeViewerSeat`, shared with the server projection) and acts as it,
// exactly as a solo board follows the owed seat. The CONTROLLED player's board
// is the other case: it stays on their own seat, and every decision the state
// says is "theirs" is in fact answered by someone else (CR 723.5). Rather than
// teach each affordance that, `lockedSeatView` restates the state the way that
// player experiences it — the input is owed by the controller — so the board's
// own "is this mine?" reads come out false.

import {
    actingPlayerFor,
    isControlledByAnother,
    type TurnControlView,
} from "@convex/gre/turnControl";
import {
    computeSoloViewerId,
    computeViewerSeat,
    type SoloViewerCtx,
} from "@convex/soloViewer";

type Owned = { playerId: string };
type WithActions = { id: string; legalActions?: unknown };

/** The fields of the projected state that name who answers, plus the local
 *  seat's server-computed affordances. Structural, so the public and the
 *  debug ("show all cards") projections both satisfy it. */
export type AnsweredState = TurnControlView & {
    priorityPlayerId?: string;
    pendingCast?: Owned;
    pendingActivation?: Owned;
    pendingTarget?: Owned;
    pendingChoices?: Owned[];
    combat?: {
        damageAssignerIds?: Record<string, string>;
        pendingAttackManaTax?: Owned;
        pendingAttackSacrifice?: Owned;
    };
    players: {
        id: string;
        hand: (WithActions | null)[];
        graveyard: WithActions[];
        exile: WithActions[];
    }[];
};

/** Whether the local seat's decisions are being made by another player. */
export function isSeatLocked(state: TurnControlView, seatId: string): boolean {
    return isControlledByAnother(state, seatId);
}

const withoutActions = <C extends WithActions>(card: C): C =>
    card.legalActions === undefined ? card : { ...card, legalActions: [] };

/** `state` as the controlled player `seatId` experiences it: every input the
 *  state owes to a seat is owed to that seat's Acting Player, and the local
 *  seat's own cards carry no action. A no-op when `seatId` is not controlled
 *  by another player. Display facts — the active player, whose permanents and
 *  whose turn — are untouched (CR 723.3). */
export function lockedSeatView<S extends AnsweredState>(
    state: S,
    seatId: string
): S {
    if (!isSeatLocked(state, seatId)) return state;
    const answering = (id: string) => actingPlayerFor(state, id);
    const owned = <T extends Owned>(pending: T | undefined): T | undefined =>
        pending
            ? { ...pending, playerId: answering(pending.playerId) }
            : pending;
    const combat = state.combat;
    return {
        ...state,
        ...(state.priorityPlayerId !== undefined
            ? { priorityPlayerId: answering(state.priorityPlayerId) }
            : {}),
        pendingCast: owned(state.pendingCast),
        pendingActivation: owned(state.pendingActivation),
        pendingTarget: owned(state.pendingTarget),
        pendingChoices: state.pendingChoices?.map((c) => owned(c)!),
        ...(combat
            ? {
                  combat: {
                      ...combat,
                      ...(combat.damageAssignerIds
                          ? {
                                damageAssignerIds: Object.fromEntries(
                                    Object.entries(
                                        combat.damageAssignerIds
                                    ).map(([source, id]) => [
                                        source,
                                        answering(id),
                                    ])
                                ),
                            }
                          : {}),
                      ...(combat.pendingAttackManaTax
                          ? {
                                pendingAttackManaTax: owned(
                                    combat.pendingAttackManaTax
                                ),
                            }
                          : {}),
                      ...(combat.pendingAttackSacrifice
                          ? {
                                pendingAttackSacrifice: owned(
                                    combat.pendingAttackSacrifice
                                ),
                            }
                          : {}),
                  },
              }
            : {}),
        players: state.players.map((player) =>
            player.id !== seatId
                ? player
                : {
                      ...player,
                      hand: player.hand.map((c) => (c ? withoutActions(c) : c)),
                      graveyard: player.graveyard.map(withoutActions),
                      exile: player.exile.map(withoutActions),
                  }
        ),
    };
}

/** What the board tells the local player about Turn Control right now. */
export type TurnControlNotice =
    | { kind: "controlling"; seatId: string }
    | { kind: "controlled"; byId: string };

/** The notice for the player who joined as `seatId`: they are controlled by
 *  another player, or they control one. `null` on every ordinary board. */
export function turnControlNotice(
    state: TurnControlView,
    seatId: string
): TurnControlNotice | null {
    const byId = actingPlayerFor(state, seatId);
    if (byId !== seatId) return { kind: "controlled", byId };
    const controlled = state.turnControls?.find(
        (c) =>
            c.active && c.controllerId === seatId && c.controlledId !== seatId
    );
    return controlled
        ? { kind: "controlling", seatId: controlled.controlledId }
        : null;
}

/** The projected fields the viewer selectors read (`SoloViewerCtx`), as the
 *  wire carries them: `priorityPlayerId` may be absent before the first
 *  priority window, the player list is `players`. */
export type ViewerSeatState = TurnControlView &
    Omit<SoloViewerCtx, "priorityPlayerId" | "playerIds" | "phase"> & {
        priorityPlayerId?: string;
        phase?: string;
        players: readonly { id: string }[];
    };

/** The seat the board of the player who joined as `playerId` views and acts
 *  as: the owed seat in Solo Mode (`soloFollow` — one user, both seats), the
 *  seat they control while it owes input (CR 723.5), else their own. The ONE
 *  place the board picks it, so it cannot drift from `getPublicState`, which
 *  runs the same two selectors on the same fields. */
export function boardViewerSeat(
    state: ViewerSeatState,
    playerId: string,
    soloFollow: boolean
): string {
    const ctx = {
        activePlayerId: state.activePlayerId,
        priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
        phase: state.phase ?? "UPKEEP",
        combat: state.combat,
        blocksDeclaredByAttacker: state.blocksDeclaredByAttacker,
        pendingCast: state.pendingCast,
        pendingActivation: state.pendingActivation,
        pendingTarget: state.pendingTarget,
        pendingChoices: state.pendingChoices,
        playerIds: state.players.map((p) => p.id),
        turnControls: state.turnControls,
    };
    return soloFollow
        ? computeSoloViewerId(ctx)
        : computeViewerSeat(ctx, playerId);
}
