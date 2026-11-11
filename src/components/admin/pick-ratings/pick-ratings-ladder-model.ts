// The rating dialog's pure model (PRD #8772, issue #8909; prototype verdict
// `ladder-pack`): the eleven rungs, which cards are comparable to the open one
// and where they land, the 15-card pack sample and the top-of-pack chance. No
// React, so the dialog's arithmetic is unit-testable.
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { effectiveRating } from "./pick-ratings-model";

/** Eleven rungs, 0.0 … 5.0 in half points. */
export const RATING_STEPS: readonly number[] = Array.from(
    { length: 11 },
    (_, i) => i / 2
);

/** The rung a rating sits on (a Scope median or a hand value rounds to it). */
export function toStep(rating: number): number {
    return Math.round(rating * 2) / 2;
}

export type CompareBy = "colour" | "cost" | "type" | "scope";

export const COMPARE_OPTIONS: readonly { value: CompareBy; label: string }[] = [
    { value: "colour", label: "Same colour" },
    { value: "cost", label: "Same cost ±1" },
    { value: "type", label: "Same type" },
    { value: "scope", label: "Whole scope" },
];

function colourless(card: ScopeCardRating): boolean {
    return !card.colours.some((colour) => colour !== "C");
}

/** Whether `other` is worth weighing `card` against. Colourless matches only
 *  colourless; a multicolour card matches any card sharing a colour. */
export function comparable(
    card: ScopeCardRating,
    other: ScopeCardRating,
    by: CompareBy
): boolean {
    switch (by) {
        case "colour":
            return colourless(card)
                ? colourless(other)
                : card.colours.some((colour) => other.colours.includes(colour));
        case "cost":
            return Math.abs(card.manaValue - other.manaValue) <= 1;
        case "type":
            return card.types.some((type) => other.types.includes(type));
        case "scope":
            return true;
    }
}

/** The comparable cards on each rung (never the open card itself), closest in
 *  cost to it first — the cards the eye should weigh it against. */
export function rungCards(
    card: ScopeCardRating,
    all: readonly ScopeCardRating[],
    by: CompareBy
): Map<number, ScopeCardRating[]> {
    const rungs = new Map<number, ScopeCardRating[]>();
    for (const other of all) {
        if (other.cardId === card.cardId || !comparable(card, other, by))
            continue;
        const step = toStep(effectiveRating(other));
        rungs.set(step, [...(rungs.get(step) ?? []), other]);
    }
    const distance = (c: ScopeCardRating) =>
        Math.abs(c.manaValue - card.manaValue);
    for (const list of rungs.values())
        list.sort(
            (a, b) => distance(a) - distance(b) || a.name.localeCompare(b.name)
        );
    return rungs;
}

export const PACK_SIZE = 15;

/** Chance that none of the pack's other 14 cards rates strictly above `card`
 *  (ties count as top). The sample is uniform over the scope: exact for the
 *  cube, an approximation for a set, which has rarity slots. */
export function topOfPackChance(
    all: readonly ScopeCardRating[],
    card: ScopeCardRating
): number {
    const pool = all.length - 1;
    const rating = effectiveRating(card);
    const higher = all.filter(
        (c) => c.cardId !== card.cardId && effectiveRating(c) > rating
    ).length;
    let chance = 1;
    for (let i = 0; i < PACK_SIZE - 1; i++) {
        const free = pool - higher - i;
        if (free <= 0) return 0;
        chance *= free / (pool - i);
    }
    return chance;
}

function hash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededRandom(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The open card plus 14 others drawn uniformly from the scope. Seeded by the
 *  card and the `roll`, so a pack does not reshuffle on every render. */
export function samplePackIds(
    all: readonly ScopeCardRating[],
    cardId: string,
    roll: number
): string[] {
    const random = seededRandom(hash(cardId) + roll);
    const others = all.filter((c) => c.cardId !== cardId).map((c) => c.cardId);
    for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
    }
    return [cardId, ...others.slice(0, PACK_SIZE - 1)];
}

/** The pack as the Bot sorts it: rating high to low, the open card ahead of a
 *  tie, then by name. */
export function sortPack(
    cards: readonly ScopeCardRating[],
    openCardId: string
): ScopeCardRating[] {
    return [...cards].sort(
        (a, b) =>
            effectiveRating(b) - effectiveRating(a) ||
            Number(b.cardId === openCardId) - Number(a.cardId === openCardId) ||
            a.name.localeCompare(b.name)
    );
}

/** Whether the pick's context can still flip `other` against the open card:
 *  within the cap the context may overturn the rating order, outside it the
 *  rating alone decides. */
export function withinContextCap(
    open: ScopeCardRating,
    other: ScopeCardRating,
    cap: number
): boolean {
    return Math.abs(effectiveRating(other) - effectiveRating(open)) <= cap;
}

/** The rating that puts a card half a point above `other`, capped at 5. */
export function justAbove(other: ScopeCardRating): number {
    return Math.min(5, effectiveRating(other) + 0.5);
}
