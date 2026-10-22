// Display order of a Draft Booster (issue #5936): rarest first, name as the
// tie-break. Pure and registry-free so the Draft Room (client) and its tests
// share the one rank table; the rarity itself is resolved server-side per
// PRINTING (`limitedEvents.ts`'s `projectEventForViewer`) — CR 206, a reprint
// sorts by the rarity it was opened at.
import type { Rarity } from "../cards/types";

/** Rarities from most to least rare — the pack's display order. */
export const RARITY_DESCENDING: readonly Rarity[] = [
    "mythic",
    "rare",
    "uncommon",
    "common",
];

/** Sort rank, lower = earlier. A card whose rarity could not be resolved
 *  (`undefined`) ranks after every commons. */
function rarityRank(rarity: Rarity | undefined): number {
    return rarity === undefined
        ? RARITY_DESCENDING.length
        : RARITY_DESCENDING.indexOf(rarity);
}

/** Comparator for `Array#sort`: rarity descending, then card name. */
export function compareDraftPackCards(
    a: { rarity?: Rarity; cardName: string },
    b: { rarity?: Rarity; cardName: string }
): number {
    return (
        rarityRank(a.rarity) - rarityRank(b.rarity) ||
        a.cardName.localeCompare(b.cardName)
    );
}

/** The pack as the client receives it: each card gains its printing's rarity
 *  (`resolveRarity`, resolved per printing server-side — one authority, the
 *  client never re-resolves). A card whose rarity does not resolve is passed
 *  through unchanged, so the field is absent rather than a placeholder. */
export function attachPackRarity<T extends { scryfallId: string }>(
    pack: readonly T[],
    resolveRarity: (scryfallId: string) => Rarity | undefined
): (T & { rarity?: Rarity })[] {
    return pack.map((card) => {
        const rarity = resolveRarity(card.scryfallId);
        return rarity === undefined ? card : { ...card, rarity };
    });
}
