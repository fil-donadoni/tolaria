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
// A window that is neither — a trivial pass, a protocol step — CLOSES the open
// decision, so an auto-pass or a confirmation submitted there never lands in
// the window of a decision it is not part of.
//
// Cheap by construction — no search, no Brain: the same work the driver
// already does on the Bot's windows.

import { shouldThink } from "@convex/gre";
import type { PublicGameState } from "@convex/gameProjections";
import { buildBotView } from "./bot-view";
import {
    botActionRealisation,
    decideBotAction,
    type BotActionRealisation,
} from "./brain";
import { projectedToGameState } from "./state-adapter";
import {
    captureHumanDecision,
    closeHumanDecision,
    ownDeckKnowledge,
} from "./human-decision-capture";

/** What a window the human seat owes means for the capture:
 *   - `start`    — a fresh decision; `continuation` names a declaration that
 *                  several saves belong to, so a click inside it does not
 *                  open a second decision;
 *   - `continue` — the next click of the decision already open (a cast's
 *                  targets or payment, an attack's mana tax);
 *   - `close`    — no decision worth a question (a trivial pass, a
 *                  protocol continuation): the open decision is finished, and
 *                  whatever the seat submits here belongs to none. */
export type HumanWindow =
    | { kind: "start"; continuation?: string }
    | { kind: "continue" }
    | { kind: "close" };

/** The realisations that PAY for a decision already under way. */
const CONTINUATIONS: ReadonlySet<BotActionRealisation> = new Set([
    "attack-tax",
    "mana-spend",
    "cast-exile-cost",
    "convoke-creatures",
    "owed-payment",
]);

/** Combat declarations take one save per click (`toggleAttacker`,
 *  `selectBlocker`, `assignBlockerTarget`) and the engine still owes the same
 *  declaration after each: the step, not the save, is the decision. */
const DECLARATION_PHASES: ReadonlySet<string> = new Set([
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
]);

export function classifyHumanWindow(
    state: PublicGameState,
    seatId: string
): HumanWindow {
    if (state.gameOver) return { kind: "close" };
    if (state.pendingCast || state.pendingActivation) {
        return { kind: "continue" };
    }
    if ((state.pendingTriggerBatch?.length ?? 0) > 0) {
        return { kind: "close" };
    }
    const action = decideBotAction(buildBotView(state, seatId));
    const realisation = botActionRealisation(action.kind);
    if (CONTINUATIONS.has(realisation)) return { kind: "continue" };
    if (realisation !== "worker") return { kind: "close" };
    if (
        action.kind === "pass" &&
        !shouldThink(projectedToGameState(state), seatId)
    ) {
        return { kind: "close" };
    }
    return DECLARATION_PHASES.has(state.phase)
        ? {
              kind: "start",
              continuation: `${state.turn}:${state.phase}:${action.kind}`,
          }
        : { kind: "start" };
}

/** Whether `state` opens a fresh decision for `seatId`. */
export function isHumanDecisionStart(
    state: PublicGameState,
    seatId: string
): boolean {
    return classifyHumanWindow(state, seatId).kind === "start";
}

/**
 * The whole PLAY-TIME path of the capture, in one call: classify the window
 * `seatId` owes on `state` and capture, continue or close accordingly — a
 * fresh decision captured as the seat's own view with the seat's own
 * decklist. Returns whether a decision was opened.
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
    const window = classifyHumanWindow(state, seatId);
    if (window.kind === "continue") return false;
    if (window.kind === "close") {
        closeHumanDecision(gameId);
        return false;
    }
    return captureHumanDecision(
        gameId,
        {
            state,
            botId: seatId,
            knowledge: ownDeckKnowledge(seatId, ownDeckCardIds),
        },
        window.continuation
    );
}
