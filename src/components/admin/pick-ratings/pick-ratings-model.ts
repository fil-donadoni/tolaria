// The Pick Ratings tool's pure view model (PRD #8772, issue #8908): one row
// per card of a scope, its effective rating and where it comes from, the
// filter algebra, the sort keys and the rail's numbers. No React, so it is
// unit-testable on the real wire shape (`listScopeCardRatings`).
import type { Color, Rarity } from "@convex/cards/types";
import type { RatingSource } from "@convex/limited/cardRatingsCore";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { matchesAny, sortRows, type SortState } from "~/lib/adminTableSort";

export type { RatingSource };

export const SOURCE_LABEL: Record<RatingSource, string> = {
    override: "Override",
    seed: "Seed",
    median: "Scope median",
};

/** Hand-written first, so an ascending Source sort lists the overrides. */
const SOURCE_RANK: Record<RatingSource, number> = {
    override: 0,
    seed: 1,
    median: 2,
};

export const RARITY_LABEL: Record<Rarity, string> = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    mythic: "Mythic",
};

const RARITY_RANK: Record<Rarity, number> = {
    common: 0,
    uncommon: 1,
    rare: 2,
    mythic: 3,
};

export type RatingSortKey =
    | "card"
    | "cost"
    | "rarity"
    | "archetypes"
    | "rating"
    | "source";

/** The table's columns, in order. */
export const RATING_COLUMNS: readonly RatingSortKey[] = [
    "card",
    "cost",
    "rarity",
    "archetypes",
    "rating",
    "source",
];

export const COLUMN_LABEL: Record<RatingSortKey, string> = {
    card: "Card",
    cost: "Cost",
    rarity: "Rarity",
    archetypes: "Archetypes",
    rating: "Rating",
    source: "Source",
};

/** DB → seed → the scope's median (issue #7652). A database row counts as an
 *  Override even when it equals the seed: a hand-written rating is what the
 *  Source filter must find. */
export function ratingSource(card: ScopeCardRating): RatingSource {
    if (card.dbRating !== null) return "override";
    if (card.seedRating !== null) return "seed";
    return "median";
}

export function effectiveRating(card: ScopeCardRating): number {
    return card.dbRating ?? card.seedRating ?? card.fallbackRating;
}

export interface RatingFilters {
    search: string;
    source: string[];
    rarity: string[];
    type: string[];
    archetype: string[];
}

export const EMPTY_FILTERS: RatingFilters = {
    search: "",
    source: [],
    rarity: [],
    type: [],
    archetype: [],
};

/** OR within a filter, AND across filters (and the name search). */
export function filterCards(
    cards: readonly ScopeCardRating[],
    filters: RatingFilters
): ScopeCardRating[] {
    const query = filters.search.trim().toLowerCase();
    return cards.filter((card) => {
        if (query && !card.name.toLowerCase().includes(query)) return false;
        return (
            matchesAny(filters.source, [ratingSource(card)]) &&
            matchesAny(filters.rarity, card.rarity ? [card.rarity] : []) &&
            matchesAny(filters.type, card.types) &&
            matchesAny(filters.archetype, card.archetypes)
        );
    });
}

function sortValue(card: ScopeCardRating, key: RatingSortKey) {
    switch (key) {
        case "card":
            return card.name;
        case "cost":
            return card.manaValue;
        case "rarity":
            return card.rarity === null ? -1 : RARITY_RANK[card.rarity];
        case "archetypes":
            return card.archetypes.join(", ");
        case "rating":
            return effectiveRating(card);
        case "source":
            return SOURCE_RANK[ratingSource(card)];
    }
}

export function sortCards(
    cards: readonly ScopeCardRating[],
    sort: SortState<RatingSortKey>
): ScopeCardRating[] {
    return sortRows(cards, sort, sortValue);
}

/** The distinct card types of the scope, for the Type filter. */
export function typeOptions(
    cards: readonly ScopeCardRating[] | undefined
): string[] {
    return [...new Set((cards ?? []).flatMap((card) => card.types))].sort();
}

/** Hand-rated (override or seed) over the WHOLE scope — never the filtered
 *  view, or the denominator would shrink with the filter that hides what is
 *  done. */
export function ratingProgress(cards: readonly ScopeCardRating[] | undefined) {
    const all = cards ?? [];
    const rated = all.filter((card) => ratingSource(card) !== "median").length;
    return { rated, total: all.length };
}

export function overrideCount(
    cards: readonly ScopeCardRating[] | undefined
): number {
    return (cards ?? []).filter((card) => ratingSource(card) === "override")
        .length;
}

export interface DistributionBucket {
    /** The whole rating the bucket is centred on: 0 … 5. */
    rating: number;
    count: number;
}

/** Effective ratings rounded to the nearest whole point, 0 … 5 always
 *  present so the bars keep their positions. */
export function ratingDistribution(
    cards: readonly ScopeCardRating[] | undefined
): DistributionBucket[] {
    const buckets = [0, 1, 2, 3, 4, 5].map((rating) => ({ rating, count: 0 }));
    for (const card of cards ?? []) {
        const index = Math.min(
            5,
            Math.max(0, Math.round(effectiveRating(card)))
        );
        buckets[index].count++;
    }
    return buckets;
}

export type ColourKey = Color;

export const COLOUR_ORDER: readonly ColourKey[] = [
    "W",
    "U",
    "B",
    "R",
    "G",
    "C",
];

export const COLOUR_LABEL: Record<ColourKey, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
    C: "Colourless",
};

export interface ColourAverage {
    colour: ColourKey;
    count: number;
    /** `null` when no card has the colour. */
    average: number | null;
}

/** Average effective rating per colour identity. A multicolour card counts
 *  towards each of its colours; a card with none is Colourless. */
export function colourAverages(
    cards: readonly ScopeCardRating[] | undefined
): ColourAverage[] {
    return COLOUR_ORDER.map((colour) => {
        const members = (cards ?? []).filter((card) =>
            colour === "C"
                ? !card.colours.some((c) => c !== "C")
                : (card.colours as string[]).includes(colour)
        );
        const total = members.reduce(
            (sum, card) => sum + effectiveRating(card),
            0
        );
        return {
            colour,
            count: members.length,
            average: members.length === 0 ? null : total / members.length,
        };
    });
}
