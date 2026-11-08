// Vintage Cube pool completeness guard (issue #8274): every implemented pool
// card has a Card Profile and a Pick Rating. The first block is the guard over
// the checked-in files; the second proves it reds on a card missing either.
import { describe, it, expect } from "vitest";
import { buildCubePool, CUBE_SOURCE_KEY } from "../cube";
import {
    getCardArchetypeFile,
    getCardCapabilityFile,
} from "../cardProfilesCore";
import { getPickRatingFile } from "../pickRatings";
import { cubePoolCoverageGaps } from "../cubePoolCoverage";

describe("every Vintage Cube pool card has a Card Profile and a Pick Rating (issue #8274)", () => {
    it("no pool id lacks a profile or a rating", () => {
        // Profiled = a row in EITHER layer's seed (ADR 0167): the split keeps
        // a censused-empty card in both, so no census verdict drops out.
        const profiles = {
            ...getCardCapabilityFile().capabilities,
            ...getCardArchetypeFile(CUBE_SOURCE_KEY)!.archetypes,
        };
        const ratings = getPickRatingFile(CUBE_SOURCE_KEY)!.ratings;
        expect(
            cubePoolCoverageGaps(buildCubePool(), profiles, ratings)
        ).toEqual({ unprofiled: [], unrated: [] });
    });
});

describe("cubePoolCoverageGaps — negative cases", () => {
    const pool = ["a", "b", "c"];

    it("names a pool card missing a profile", () => {
        expect(
            cubePoolCoverageGaps(pool, { a: {}, c: {} }, { a: 1, b: 1, c: 1 })
        ).toEqual({ unprofiled: ["b"], unrated: [] });
    });

    it("names a pool card missing a rating", () => {
        expect(
            cubePoolCoverageGaps(pool, { a: {}, b: {}, c: {} }, { a: 1, b: 1 })
        ).toEqual({ unprofiled: [], unrated: ["c"] });
    });
});
