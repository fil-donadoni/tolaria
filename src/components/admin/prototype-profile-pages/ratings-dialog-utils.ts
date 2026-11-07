// PROTOTYPE — throwaway. Non-component bits of the ratings dialogs.
import type { ProtoRatingCard } from "./proto-data";

export const RATING_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export const toStep = (r: number) => Math.round(r * 2) / 2;

export const SOURCE_LABEL: Record<ProtoRatingCard["source"], string> = {
    override: "Override",
    seed: "Seed",
    fallback: "Scope median",
    unrated: "Unrated",
};

export const PACK_SIZE = 15;

/** Chance no strictly-higher card shows up among the pack's other 14 cards. */
export function topOfPackChance(
    all: readonly ProtoRatingCard[],
    card: ProtoRatingCard
) {
    const pool = all.length - 1;
    const higher = all.filter(
        (c) => c.cardId !== card.cardId && (c.rating ?? 0) > (card.rating ?? 0)
    ).length;
    let p = 1;
    for (let i = 0; i < PACK_SIZE - 1; i++) {
        const free = pool - higher - i;
        if (free <= 0) return 0;
        p *= free / (pool - i);
    }
    return p;
}
