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
 * Orders the cards of a filtered pick: eligible (allow-listed) cards first,
 * then everything sorted by type line, with card name as the tiebreaker.
 * `eligibleIds` is `undefined` for an unfiltered pick — then no bucket split
 * happens and cards sort purely by type/name.
 *
 * Used by every picker whose zone carries NO game-significant order — the
 * library search (issue #933), and the revealed-hand pick (Inquisition of
 * Kozilek / Thoughtseize), where hunting the two legal cards out of a
 * seven-card grid is the whole task. The GRAVEYARD deliberately does NOT use
 * it: graveyard order is real game state (CR 400.2 — Ashen Ghoul counts the
 * creature cards ABOVE it), so its picker must keep showing the true order.
 *
 * Pure, non-mutating: returns a new array so the projected zone stays
 * untouched.
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
