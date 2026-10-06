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

/**
 * Whose decision the quiz is judging (issue #3986): the Bot's, from the debug
 * ring, or the PLAYER's own, offered back after the game as a Verdict Proposal.
 * The lowering always names the deciding seat "the Bot" — on a proposal that
 * seat is the reader, so everything the quiz SHOWS is re-voiced; nothing it
 * SUBMITS is, so the stored Verdict does not depend on the feed.
 */
export type QuizPerspective = "bot" | "player";

/** The board's seat names when the deciding seat is the player. */
export function quizSeatLabelsFor(
    botSeat: ScenarioSeat,
    perspective: QuizPerspective
): Record<ScenarioSeat, string> {
    if (perspective === "bot") return quizSeatLabels(botSeat);
    return botSeat === "me"
        ? { me: "You", opp: "Bot" }
        : { me: "Bot", opp: "You" };
}

const ROLE_NAMES: Record<string, string> = {
    "the Bot's": "your",
    "the Bot": "you",
    "the opponent's": "the Bot's",
    "the opponent": "the Bot",
};

/** A candidate's sentence as the reader should hear it: on a proposal, the
 *  lowering's "the Bot" is the player and "the opponent" is the Bot. */
export function candidateSentence(
    description: string,
    perspective: QuizPerspective
): string {
    if (perspective === "bot") return description;
    return description.replace(
        /\bthe Bot's|\bthe Bot\b|\bthe opponent's|\bthe opponent\b/g,
        (role) => ROLE_NAMES[role]
    );
}

/** On a proposal the deciding hand is the reader's own: shown, never behind
 *  the debugging consent, and the hazard is the other way round. */
export const PROPOSAL_HAND_NOTE =
    "Your hand is shown; the Bot's stays hidden. Judge on what you could see when you decided.";
