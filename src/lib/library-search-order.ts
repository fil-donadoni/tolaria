import { tryGetDefinition } from "@convex/cards";
import { getCardImageDefId } from "~/lib/card-image-signature";
import type { CardInstance } from "~/types/game";

/** Type line + name of a search-pile card, resolved from the card registry
 *  (the wire projection strips `card.card` to `{ id }`, so name/types are not
 *  on the instance — they come from the static definition). Missing
 *  definitions (tokens, unknown ids) sort last within their bucket. */
function sortKey(card: CardInstance): { type: string; name: string } {
    const def = tryGetDefinition(getCardImageDefId(card));
    return {
        type: def ? def.types.join(" ") : "￿",
        name: def ? def.name : "￿",
    };
}

/**
 * Orders the cards of a `search-library` pick (issue #933 follow-up): eligible
 * (allow-listed) cards first, then everything sorted by type line, with card
 * name as the tiebreaker. `eligibleIds` is `undefined` for an unfiltered
 * search — then no bucket split happens and cards sort purely by type/name.
 *
 * Pure, non-mutating: returns a new array so the projected `librarySearch`
 * stays untouched.
 */
export function orderLibrarySearchCards(
    cards: CardInstance[],
    eligibleIds?: ReadonlySet<string>
): CardInstance[] {
    return [...cards].sort((a, b) => {
        if (eligibleIds) {
            const aEligible = eligibleIds.has(a.id);
            const bEligible = eligibleIds.has(b.id);
            if (aEligible !== bEligible) return aEligible ? -1 : 1;
        }
        const ka = sortKey(a);
        const kb = sortKey(b);
        return ka.type.localeCompare(kb.type) || ka.name.localeCompare(kb.name);
    });
}
