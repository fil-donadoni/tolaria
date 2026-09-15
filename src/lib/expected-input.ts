import {
    computeExpectedInput,
    computeOwedPlayerIds,
    type ExpectedInputKind,
} from "@convex/gre/expectedInput";
import type { GameState } from "@convex/gre/state";
import type {
    Combat,
    GameOver,
    PendingChoice,
    PendingTarget,
} from "~/types/game";

/** The slice of the projected board the Expected Input derivation reads
 *  (ADR 0047). Every field is one the `GameContext` value already carries, so
 *  a board surface passes its context straight in. */
export type ExpectedInputView = {
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    combat?: Combat;
    meleeCombat?: boolean;
    pendingTarget?: PendingTarget;
    pendingChoices?: PendingChoice[];
    gameOver?: GameOver;
    allPlayers: readonly { id: string }[];
};

/** The projection as the engine's own derivation reads it. The client never
 *  re-derives "what is the game waiting for" (issue #3616): it hands the
 *  fields it was projected to `computeExpectedInput` / `computeOwedPlayerIds`,
 *  the SAME functions `assertExpectedInput` and the vs-AI tick row read
 *  (ADR 0074 — the frontend shares the pure module, never the authority). */
function asEngineState(view: ExpectedInputView): GameState {
    return {
        gameOver: view.gameOver,
        pendingChoices: view.pendingChoices,
        pendingTarget: view.pendingTarget,
        phase: view.phase,
        combat: view.combat,
        meleeCombat: view.meleeCombat,
        activePlayerId: view.activePlayerId,
        priorityPlayerId: view.priorityPlayerId,
        players: view.allPlayers,
    } as unknown as GameState;
}

/** Whether the game is waiting on `viewerId` for ANY input right now — a
 *  Priority window, a target, a mid-resolution choice, a blocker declaration,
 *  a combat-damage assignment. Membership in `computeOwedPlayerIds`, never
 *  equality with one id, so a non-active damage assigner counts. A card the
 *  viewer clicks while this is false answers nothing (issue #3616). */
export function viewerOwesInput(
    view: ExpectedInputView,
    viewerId: string
): boolean {
    return computeOwedPlayerIds(asEngineState(view)).includes(viewerId);
}

/** Whether a mutation declaring `expect` from `playerId` would pass the
 *  Expected Input gate's kind and player checks — the two
 *  `assertExpectedInput` throws "waiting for X input, not Y" and "waiting for
 *  X input from another player". A cast / play / hand activation declares
 *  `"priority"`. */
export function expectedInputAdmits(
    view: ExpectedInputView,
    request: { playerId: string; expect: ExpectedInputKind }
): boolean {
    const current = computeExpectedInput(asEngineState(view));
    return (
        current?.kind === request.expect &&
        current.playerId === request.playerId
    );
}
