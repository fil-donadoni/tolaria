// Manual Board runtime (PRD #2162, issue #2169) — the single value every
// injected manual seam closes over.
//
// The Manual Board is a thin container: it queries `getManualState`, adapts it
// to the board's `Player` view type (`manual-board-adapter.ts`), and mounts the
// SHARED board surface with manual behaviour injected at the seams the earlier
// slices opened. Each seam takes a function; every one of those functions needs
// the same three things — who the viewer is, what the current manual state is,
// and how to dispatch a manual verb. Bundling them into one runtime object is
// what lets each seam factory stay a PLAIN function (no React hooks, no extra
// context), so it can be built once in the container and handed straight to the
// provider.
//
// Pure: no Convex, no React, no DOM. The container owns the `useMutation`
// calls and hands their bound results in as {@link ManualDispatch}.

import type {
    ManualZone,
    ProjectedManualCard,
    ProjectedManualGameState,
} from "@convex/manual";

/** Every manual verb this board can dispatch, already bound to the game id.
 *  One entry per `convex/game.ts` `manual*` mutation the board surfaces —
 *  nothing here adds server capability, it only names what already exists. */
export type ManualDispatch = {
    moveCard: (args: {
        instanceId: string;
        toZone: ManualZone;
        index?: number;
    }) => void;
    setTapped: (args: { instanceId: string; tapped: boolean }) => void;
    untapAll: (args: { playerId: string }) => void;
    adjustLife: (args: { playerId: string; delta: number }) => void;
    adjustCounter: (args: {
        instanceId: string;
        type: string;
        delta: number;
    }) => void;
    setFaceDown: (args: { instanceId: string; faceDown: boolean }) => void;
    setLane: (args: { instanceId: string; lane: "main" | "combat" }) => void;
    attach: (args: { instanceId: string; targetId: string }) => void;
    draw: (args: { playerId: string; n: number }) => void;
    mill: (args: { playerId: string; n: number }) => void;
    exileTop: (args: { playerId: string; n: number }) => void;
    peek: (args: { playerId: string; n: number }) => void;
    shuffle: (args: { playerId: string }) => void;
    setNote: (args: { instanceId: string; text: string }) => void;
    endTurn: (args: { playerId: string }) => void;
    concede: (args: { playerId: string }) => void;
};

/** Everything an injected manual seam reads. */
export type ManualRuntime = {
    /** The seat steering this client. */
    viewerId: string;
    /** The projected manual state this render is drawn from. */
    state: ProjectedManualGameState;
    /** Every card the viewer can see, by instance id — the oracle a drag drop
     *  and a card verb both consult (which zone is it in? is it tapped?). */
    cardById: Map<string, ProjectedManualCard>;
    dispatch: ManualDispatch;
};

/** Indexes every visible card in a projected manual state by instance id.
 *  Hidden opponent hand slots project as `null` and are skipped. */
export function indexManualCards(
    state: ProjectedManualGameState
): Map<string, ProjectedManualCard> {
    const byId = new Map<string, ProjectedManualCard>();
    for (const player of state.players) {
        for (const card of player.battlefield) byId.set(card.id, card);
        for (const card of player.hand) if (card) byId.set(card.id, card);
        for (const card of player.graveyard) byId.set(card.id, card);
        for (const card of player.exile) byId.set(card.id, card);
    }
    return byId;
}
