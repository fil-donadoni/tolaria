// One seat's deck knowledge as the vs-AI driver reads it (issue #5617): the
// decklist the Brain's search may sample that seat's hidden zones from, as
// Card Definition ids.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

type KnowledgeRow =
    | FunctionReturnType<typeof api.gameReads.getSeatDeckKnowledge>
    | undefined;
type SeatDeckRow =
    | FunctionReturnType<typeof api.gameReads.getSeatDeck>
    | undefined;

export interface SeatKnowledge {
    /** One id per copy, decklist order. */
    cardIds: string[];
}

/**
 * The seat's knowledge from `gameReads.getSeatDeckKnowledge`, or `undefined`
 * while it loads or when the seat has none. A Game built before the deck was
 * stored on its manifest rows answers `null` there; its stored deck entries
 * (`gameReads.getSeatDeck`) are then read as they are — print ids included,
 * as before issue #5617.
 */
export function seatKnowledge(
    knowledge: KnowledgeRow,
    legacyDeck: SeatDeckRow
): SeatKnowledge | undefined {
    if (knowledge) {
        return { cardIds: knowledge.cardIds };
    }
    if (knowledge === null && legacyDeck?.cards) {
        return { cardIds: legacyDeck.cards.map((c) => c.cardId) };
    }
    return undefined;
}
