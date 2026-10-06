// Does the human seat owe a DECISION on this state, or only the next click of
// one already under way? (issue #3984)
//
// The question the Bot's own driver answers for its seat every window, asked of
// the other seat with the SAME gate: `decideBotAction` over the seat's view
// says what kind of input the engine is waiting on, `botActionRealisation` says
// whether that input is a real search decision (`"worker"`) or a continuation
// realised directly — a parked payment, a damage confirmation, a mana-spend
// order — and `shouldThink` drops the trivial pass the Bot would not have
// thought about either. A decision mid-flight (a spell announced, its targets
// or payment still owed) is never a fresh one: the executor realises the whole
// cast as one move, so the window that started it keeps collecting its calls.
//
// Cheap by construction — no search, no Brain: the same work the driver
// already does on the Bot's windows.

import { shouldThink } from "@convex/gre";
import type { PublicGameState } from "@convex/gameProjections";
import { buildBotView } from "./bot-view";
import { botActionRealisation, decideBotAction } from "./brain";
import { projectedToGameState } from "./state-adapter";
import {
    captureHumanDecision,
    ownDeckKnowledge,
} from "./human-decision-capture";

export function isHumanDecisionStart(
    state: PublicGameState,
    seatId: string
): boolean {
    if (state.gameOver) return false;
    if (state.pendingCast || state.pendingActivation) return false;
    if ((state.pendingTriggerBatch?.length ?? 0) > 0) return false;
    const action = decideBotAction(buildBotView(state, seatId));
    if (botActionRealisation(action.kind) !== "worker") return false;
    if (action.kind !== "pass") return true;
    return shouldThink(projectedToGameState(state), seatId);
}

/**
 * The whole PLAY-TIME path of the capture, in one call: when `state` opens a
 * fresh decision for `seatId`, capture it as the seat's own view with the
 * seat's own decklist. Returns whether a decision was captured.
 *
 * Everything the vs-Bot game does for the human seat while the game is on goes
 * through here and through `recordHumanCall` — and neither ever consults the
 * Brain (the guarding test watches the search's own root-decision sink).
 */
export function observeHumanWindow(
    gameId: string,
    state: PublicGameState,
    seatId: string,
    ownDeckCardIds: readonly string[] | undefined
): boolean {
    if (!isHumanDecisionStart(state, seatId)) return false;
    return captureHumanDecision(gameId, {
        state,
        botId: seatId,
        knowledge: ownDeckKnowledge(seatId, ownDeckCardIds),
    });
}
