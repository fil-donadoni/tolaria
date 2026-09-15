// The verdict quiz's hand-reveal copy (issue #3577, ADR 0128 §12).
//
// Two sentences carry what no mechanism can: the reveal's COST, which the
// tester consents to before seeing a card, and the residual hazard of the
// tester's own hand — information the Bot did not have, and a judgement resting
// on it teaches the evaluation a preference it can never justify (ADR 0124:
// hidden information is outside what a fit can do).

import type { ScenarioSeat } from "./scenario-spec-board-model";

export const HAND_REVEAL_LABEL = "Reveal the Bot's hand";

export const HAND_REVEAL_CONSENT =
    "This turns the match into a debugging session: you will see cards you would not otherwise see.";

export const OWN_HAND_REMINDER =
    "Your own hand is information the Bot did not have. Judge on what it could see — a verdict resting on your hand teaches the evaluation a preference it can never justify.";

/** The board's seat names in the quiz: the seat that decided is the Bot. */
export function quizSeatLabels(
    botSeat: ScenarioSeat
): Record<ScenarioSeat, string> {
    return botSeat === "me"
        ? { me: "Bot", opp: "Opponent" }
        : { me: "Opponent", opp: "Bot" };
}
