// Builds the slim `BotView` the cheap main-thread gate reasons about, from the
// bot's projected wire state (ADR 0001, issues #109/#145). Pure and React-free
// so it can be unit/integration tested without a browser: the driver hook and
// the tests share this one builder.
//
// `enumerateMoves` / the ISMCTS search only run for windows the gate flags as
// worth a Worker round-trip; the mulligan heuristic (issue #145) is resolved
// here on the main thread from `mulliganHand` / `mulligansTaken` and never
// reaches the Worker.

import type { PublicGameState } from "@convex/gameProjections";
import type { Move } from "@convex/gre";
import type { BotAction, BotView } from "./brain";

/** Land detection on a projected hand card. The slim instance keeps the
 *  `types` array from `CardInstanceState` (only `card` is stripped), so a land
 *  is any card whose printed types include "Land" (CR 305.1). */
function handCardIsLand(types: string[] | undefined): boolean {
    return (types ?? []).includes("Land");
}

/** Project the bot-viewpoint `PublicGameState` into the gate's decision window.
 *  Pure: reads only the bot's own (visible) hand and the public mulligan /
 *  combat / priority fields. */
export function buildBotView(state: PublicGameState, botId: string): BotView {
    const combat = state.combat;
    const view: BotView = {
        botId,
        phase: state.phase ?? "UPKEEP",
        priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
        activePlayerId: state.activePlayerId,
        hasCombat: combat !== undefined,
        attackersConfirmed: combat?.confirmed === true,
        blockersConfirmed: combat?.blockersConfirmed === true,
        mulliganDeclaringId: state.mulligan?.declaringPlayerId,
        mulliganBottoming: state.mulligan?.bottoming === true,
        gameOver: state.gameOver !== undefined,
    };

    // Mulligan window: expose the bot's hand (land flags) and counts so the
    // gate can run the land-count keep/mull heuristic and the bottom-N pick.
    if (state.phase === "MULLIGAN" && state.mulligan) {
        const myIndex = state.players.findIndex((p) => p.id === botId);
        if (myIndex !== -1) {
            view.mulligansTaken = state.mulligan.mulligansTaken[myIndex] ?? 0;
            view.mulliganHand = state.players[myIndex].hand
                .filter((c): c is NonNullable<typeof c> => c !== null)
                .map((c) => ({ id: c.id, isLand: handCardIsLand(c.types) }));
        }
        const head = state.pendingChoices?.[0];
        if (
            head &&
            head.kind === "mulligan-bottom" &&
            head.playerId === botId
        ) {
            view.mulliganBottomCount =
                typeof head.count === "number" ? head.count : head.count.max;
        }
    }

    return view;
}

/** Translate a mulligan-phase gate decision into the `Move` the executor
 *  realises (issue #145). The keep / mull / bottom choice is made by the cheap
 *  main-thread heuristic, NOT the Worker search (ISMCTS mulligan evaluation is
 *  out of scope), so these windows short-circuit straight to a `Move`. Returns
 *  null when the action is not a mulligan decision or the bottoming choice
 *  identity can't be read from the state. */
export function mulliganActionToMove(
    action: BotAction,
    state: PublicGameState,
    botId: string
): Move | null {
    if (action.kind === "keep" || action.kind === "mull") {
        return { kind: "mulligan", decision: action.kind };
    }
    if (action.kind === "mulligan-bottom") {
        const head = state.pendingChoices?.[0];
        if (
            !head ||
            head.kind !== "mulligan-bottom" ||
            head.playerId !== botId
        ) {
            return null;
        }
        return {
            kind: "mulligan-bottom",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: action.cardInstanceIds,
        };
    }
    return null;
}
