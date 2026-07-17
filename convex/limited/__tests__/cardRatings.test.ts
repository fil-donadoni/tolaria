// Bot Drafter Pick Rating DB layer tests (PRD #1296 Slice A, ADR 0066, issue
// #1297). Mirrors `pickRatings.test.ts`/`botDrafter.test.ts`'s discipline:
// pure functions, deterministic, no convex-test harness needed —
// `resolveEventPickRating` is handed a plain in-memory `GetDbRating` closure
// standing in for `ctx.db`, exactly like `convex/limitedEvents.ts`'s real
// `loadEventPickRating` builds one from a `cardRatings` table scan.
import { describe, it, expect } from "vitest";
import { resolveEventPickRating, type GetDbRating } from "../cardRatings";
import { getPickRating, getPickRatingFile } from "../pickRatings";

/** Builds a `GetDbRating` from a plain `(scope, cardId) -> rating` map — the
 *  test-side stand-in for a `cardRatings` table scan. */
function fakeDb(rows: Record<string, Record<string, number>>): GetDbRating {
    return (scope, cardId) => rows[scope]?.[cardId] ?? null;
}

describe("resolveEventPickRating (PRD #1296 Slice A, issue #1297): the layering boundary", () => {
    it("a database row OVERRIDES the seed rating for the same (scope, cardId)", () => {
        // Black Lotus is curated in the checked-in LEA seed file — pick a
        // real seed-rated cardId so the override is provably an override,
        // not just "the only rating that exists".
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];
        expect(seedRating).not.toBeNull();

        const dbOverride = seedRating === 1 ? 2 : 1; // guaranteed different
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ lea: { [cardId]: dbOverride } })
        );
        expect(getPickRatingFn(cardId)).toBe(dbOverride);
        expect(getPickRatingFn(cardId)).not.toBe(seedRating);
    });

    it("absent from the database -> falls back to the seed rating", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const [cardId, seedRating] = Object.entries(leaRatings.ratings)[0];

        const getPickRatingFn = resolveEventPickRating(["lea"], fakeDb({}));
        expect(getPickRatingFn(cardId)).toBe(seedRating);
    });

    it("absent from BOTH the database and the seed -> null (Pick Heuristic alone)", () => {
        const getPickRatingFn = resolveEventPickRating(["lea"], fakeDb({}));
        expect(getPickRatingFn("not-a-real-card-id")).toBeNull();
    });

    it("a multi-scope event resolves a rating from ANY of its distinct scopes", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea", "vintage-cube"],
            fakeDb({ "vintage-cube": { "some-cube-card": 4.5 } })
        );
        expect(getPickRatingFn("some-cube-card")).toBe(4.5);
    });

    it("dedupes a repeated scope (a 3-round mono-set Draft's packSlots) without changing the result", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea", "lea", "lea"],
            fakeDb({ lea: { "card-x": 3 } })
        );
        expect(getPickRatingFn("card-x")).toBe(3);
    });

    it("a database row for a scope OUTSIDE the event's scopes never leaks in", () => {
        // The row exists for "ice", but this event only drafts "lea" — the
        // rating must not apply even though the cardId is the same.
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ ice: { "shared-card-id": 5 } })
        );
        expect(getPickRatingFn("shared-card-id")).toBeNull();
    });

    it("scope matching is case-insensitive (mirrors packSlots/pickRatings.ts discipline)", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["LEA"],
            fakeDb({ lea: { "card-y": 2 } })
        );
        expect(getPickRatingFn("card-y")).toBe(2);
    });

    it("regression: an empty database (every getDbRating call returns null) reproduces the seed-only path byte-for-byte", () => {
        const leaRatings = getPickRatingFile("lea")!;
        const emptyDb = resolveEventPickRating(["lea"], fakeDb({}));
        for (const cardId of Object.keys(leaRatings.ratings)) {
            expect(emptyDb(cardId)).toBe(getPickRating("lea", cardId));
        }
        // And a card the seed file doesn't rate at all still falls through
        // to null, exactly as the pre-database code path did.
        expect(emptyDb("totally-unrated-card")).toBeNull();
    });

    it("a rating of exactly 0 from the database is honoured, not treated as falsy/absent", () => {
        const getPickRatingFn = resolveEventPickRating(
            ["lea"],
            fakeDb({ lea: { "never-play-this": 0 } })
        );
        expect(getPickRatingFn("never-play-this")).toBe(0);
    });
});
