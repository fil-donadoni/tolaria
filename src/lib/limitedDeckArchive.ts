// The player's Limited Deck Archive (PRD #8407, issue #8409): a view over the
// live deck list, never a store. PURE — it reads no Limited Event, so a deck
// outlives its Event here exactly as its Deck Pool does (ADR 0106 §6), and a
// rename, an edit or a deletion is the next render of the list it is given.
import type { LobbyDeck } from "./deckTypes";
import { groupByLimitedOrigin, type OriginGroup } from "./matchSetupDeckGrid";

/** The caller's own Limited decks by Limited Origin: groups sorted by label,
 *  the unclassified group last. A preset is nobody's archive. */
export function limitedDeckArchiveGroups(
    decks: readonly LobbyDeck[]
): OriginGroup[] {
    return groupByLimitedOrigin(
        decks
            .filter((deck) => deck.kind === "user" && deck.format === "limited")
            .map((deck) => ({
                deck,
                matchedCard: null,
                selectable: deck.isLegal,
            }))
    );
}
