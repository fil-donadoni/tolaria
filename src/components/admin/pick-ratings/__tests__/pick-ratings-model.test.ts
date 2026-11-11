// Pick Ratings view model (PRD #8772, issue #8908) on real projected rows.
import { describe, it, expect } from "vitest";
import {
    buildScopeCardRatings,
    listScopeCards,
} from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { tryGetCardByName } from "@convex/cards";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import {
    colourAverages,
    effectiveRating,
    ratingDistribution,
    ratingProgress,
    ratingSource,
} from "../pick-ratings-model";

function row(name: string, db: number | null): ScopeCardRating {
    const id = tryGetCardByName(name)!.id;
    const card = listScopeCards(CUBE_SOURCE_KEY).find((c) => c.cardId === id)!;
    return buildScopeCardRatings(
        CUBE_SOURCE_KEY,
        [card],
        () => db
    )[0] as ScopeCardRating;
}

describe("pick ratings model", () => {
    it("a database row is an Override and wins over the seed and the median", () => {
        const r = row("Lightning Bolt", 3.3);
        expect(ratingSource(r)).toBe("override");
        expect(effectiveRating(r)).toBe(3.3);
    });

    it("without a database row the source is the seed, else the scope median", () => {
        const r = row("Lightning Bolt", null);
        expect(ratingSource(r)).toBe(r.seedRating === null ? "median" : "seed");
        expect(effectiveRating(r)).toBe(r.seedRating ?? r.fallbackRating);
    });

    it("progress counts override or seed over the whole scope", () => {
        const cards = [row("Lightning Bolt", 2), row("Black Lotus", 4)];
        expect(ratingProgress(cards)).toEqual({ rated: 2, total: 2 });
        expect(ratingProgress(undefined)).toEqual({ rated: 0, total: 0 });
    });

    it("the distribution always spans 0..5 and totals the cards", () => {
        const dist = ratingDistribution([row("Lightning Bolt", 4.6)]);
        expect(dist.map((b) => b.rating)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(dist[5].count).toBe(1);
    });

    it("a colour's average covers the cards carrying it", () => {
        const red = colourAverages([
            row("Lightning Bolt", 4),
            row("Black Lotus", 2),
        ]);
        expect(red.find((c) => c.colour === "R")).toEqual({
            colour: "R",
            count: 1,
            average: 4,
        });
        expect(red.find((c) => c.colour === "C")?.count).toBe(1);
    });
});
