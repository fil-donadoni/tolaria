import type { LimitedPoolCard } from "@convex/limited/eventTypes";

export interface GroupedPoolCard {
    cardId: string;
    cardName: string;
    count: number;
}

/** Groups a flat, one-entry-per-physical-card Pool (`LimitedPoolCard[]`, one
 *  per opened Booster card) into display counts by canonical Card ID —
 *  mirrors how `convex/formats.ts`'s `buildPool` groups the same shape for
 *  legality, kept separate since this is a display concern (card NAME
 *  ordering), not a legality one. */
export function groupPoolCards(pool: LimitedPoolCard[]): GroupedPoolCard[] {
    const counts = new Map<string, GroupedPoolCard>();
    for (const card of pool) {
        const existing = counts.get(card.cardId);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(card.cardId, {
                cardId: card.cardId,
                cardName: card.cardName,
                count: 1,
            });
        }
    }
    return [...counts.values()].sort((a, b) =>
        a.cardName.localeCompare(b.cardName)
    );
}
