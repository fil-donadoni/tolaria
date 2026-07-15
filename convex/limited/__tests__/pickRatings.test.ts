// Pick Rating file format guard tests (issue #1117, ADR 0054/0055's Pick
// Rating layer). Mirrors `botDrafter.test.ts`'s discipline: pure functions,
// deterministic, no convex-test harness needed. The catalogue-wide guard
// (first `describe` block) is what actually runs in CI over the checked-in
// `data/pick-ratings/lea.json`; the rest exercise `validatePickRatingFile`'s
// own two checks against hand-built fixtures.
import { describe, it, expect } from "vitest";
import { getBoosterConfig } from "../registry";
import {
    getPickRating,
    getPickRatingByCardId,
    getPickRatingFile,
    PICK_RATING_MAX,
    PICK_RATING_MIN,
    validatePickRatingFile,
    type PickRatingFile,
} from "../pickRatings";

describe("checked-in LEA Pick Rating file (issue #1117 acceptance: 'ratings file format defined and validated')", () => {
    const leaConfig = getBoosterConfig("lea")!;
    const leaRatings = getPickRatingFile("lea")!;

    it("the LEA Booster Config and Pick Rating file are both checked in", () => {
        expect(leaConfig).not.toBeNull();
        expect(leaRatings).not.toBeNull();
        expect(leaRatings.setCode).toBe("lea");
    });

    it("every rated entry resolves to a card of the LEA set, and every rating is in bounds", () => {
        const result = validatePickRatingFile(leaRatings, leaConfig);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it("ships with a non-trivial curated set of ratings (not an empty stub)", () => {
        expect(Object.keys(leaRatings.ratings).length).toBeGreaterThan(50);
    });

    it("bombs rate above vanilla commons (acceptance: 'e.g. the power cards rate above vanilla commons')", () => {
        // Black Lotus (Power Nine) vs. Grizzly Bears (vanilla 2/2 common) —
        // both explicitly curated in the checked-in file.
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const grizzlyBearsId = "ce2d603a-3231-4a8c-bf39-1617586ea870";
        const lotusRating = getPickRating("lea", blackLotusId);
        const bearsRating = getPickRating("lea", grizzlyBearsId);
        expect(lotusRating).not.toBeNull();
        expect(bearsRating).not.toBeNull();
        expect(lotusRating!).toBeGreaterThan(bearsRating!);
        expect(lotusRating).toBe(PICK_RATING_MAX);
    });

    it("a card the curated file doesn't cover falls back to `null` (unrated)", () => {
        // Shanodin Dryads is a real LEA common not present in the curated file.
        const shanodinDryadsId = "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8";
        expect(leaRatings.ratings[shanodinDryadsId]).toBeUndefined();
        expect(getPickRating("lea", shanodinDryadsId)).toBeNull();
    });
});

describe("getPickRatingFile / getPickRating (a Draftable Set without a ratings file)", () => {
    it("returns null for a set code with no checked-in Pick Rating file", () => {
        expect(getPickRatingFile("madeupset")).toBeNull();
        expect(getPickRating("madeupset", "any-card-id")).toBeNull();
    });

    it("is case-insensitive on the set code, like `registry.ts`'s `getBoosterConfig`", () => {
        expect(getPickRatingFile("LEA")).not.toBeNull();
        expect(getPickRatingFile("Lea")).not.toBeNull();
    });
});

describe("getPickRatingByCardId (registry-agnostic lookup)", () => {
    it("resolves a rated LEA card by cardId alone, with no set code", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        expect(getPickRatingByCardId(blackLotusId)).toBe(PICK_RATING_MAX);
    });

    it("returns null for a cardId no checked-in file rates", () => {
        expect(getPickRatingByCardId("not-a-real-card-id")).toBeNull();
    });
});

describe("validatePickRatingFile — negative cases (issue #1117 acceptance: 'scale bounds enforced by a guard test')", () => {
    const leaConfig = getBoosterConfig("lea")!;

    it("flags a cardId absent from the set's Booster Config sheets", () => {
        const badFile: PickRatingFile = {
            setCode: "lea",
            ratings: { "not-a-lea-card": 3 },
        };
        const result = validatePickRatingFile(badFile, leaConfig);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("does not resolve"))).toBe(
            true
        );
    });

    it("flags a rating above PICK_RATING_MAX", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const badFile: PickRatingFile = {
            setCode: "lea",
            ratings: { [blackLotusId]: PICK_RATING_MAX + 1 },
        };
        const result = validatePickRatingFile(badFile, leaConfig);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("out of bounds"))).toBe(
            true
        );
    });

    it("flags a rating below PICK_RATING_MIN", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const badFile: PickRatingFile = {
            setCode: "lea",
            ratings: { [blackLotusId]: PICK_RATING_MIN - 1 },
        };
        const result = validatePickRatingFile(badFile, leaConfig);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("out of bounds"))).toBe(
            true
        );
    });

    it("flags a non-finite rating (NaN/Infinity smuggled in by a hand edit)", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const badFile: PickRatingFile = {
            setCode: "lea",
            ratings: { [blackLotusId]: Number.POSITIVE_INFINITY },
        };
        const result = validatePickRatingFile(badFile, leaConfig);
        expect(result.valid).toBe(false);
    });

    it("accepts a fractional rating within bounds (Draftmancer-style granularity)", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const okFile: PickRatingFile = {
            setCode: "lea",
            ratings: { [blackLotusId]: 3.5 },
        };
        const result = validatePickRatingFile(okFile, leaConfig);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});
