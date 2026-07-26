// Card Profile resolver seam tests (ADR 0072, PRD #1607 slice 1, issue
// #1608). Mirrors `cardRatings.bot.test.ts`'s discipline exactly: pure
// functions, deterministic, no convex-test harness needed —
// `resolveEventCardProfile` is handed a plain in-memory `GetDbProfile`
// closure standing in for `ctx.db`, the same shape `resolveEventPickRating`
// is handed `GetDbRating`.
import { describe, it, expect } from "vitest";
import {
    resolveEventCardProfile,
    getCardProfile,
    getCardProfileFile,
    validateCardProfileFile,
    type GetDbProfile,
    type CardProfile,
    type CardProfileFile,
} from "../cardProfiles";

/** Builds a `GetDbProfile` from a plain `(scope, cardId) -> CardProfile` map
 *  — the test-side stand-in for a `cardProfiles` table scan. */
function fakeDb(
    rows: Record<string, Record<string, CardProfile>>
): GetDbProfile {
    return (scope, cardId) => rows[scope]?.[cardId] ?? null;
}

function profile(overrides: Partial<CardProfile> = {}): CardProfile {
    return {
        archetypes: [],
        provides: [],
        requires: [],
        reviewed: false,
        ...overrides,
    };
}

describe("resolveEventCardProfile (ADR 0072, issue #1608): the layering boundary", () => {
    it("a database row is returned when present", () => {
        const dbProfile = profile({ archetypes: ["reanimator"], provides: ["reanimatable"] });
        const getProfileFn = resolveEventCardProfile(
            ["vintage-cube"],
            fakeDb({ "vintage-cube": { "worldspine-wurm": dbProfile } })
        );
        expect(getProfileFn("worldspine-wurm")).toEqual(dbProfile);
    });

    it("absent from the database -> falls back to the seed layer (null today, this slice ships no seed file)", () => {
        const getProfileFn = resolveEventCardProfile(["vintage-cube"], fakeDb({}));
        expect(getProfileFn("worldspine-wurm")).toBeNull();
    });

    it("absent from BOTH the database and the seed -> null", () => {
        const getProfileFn = resolveEventCardProfile(["vintage-cube"], fakeDb({}));
        expect(getProfileFn("not-a-real-card-id")).toBeNull();
    });

    it("a database row OVERRIDES what the seed layer would have returned for the same (scope, cardId)", () => {
        // This slice ships no checked-in seed data, so `getCardProfile`
        // always returns null for every scope — assert the DB layer wins
        // regardless, which is the override behavior `resolveEventPickRating`
        // exhibits once a seed file exists. Not a self-fulfilling check:
        // `getCardProfile("vintage-cube", ...)` is called for real inside
        // `resolveEventCardProfile` and must not clobber the DB result.
        expect(getCardProfile("vintage-cube", "worldspine-wurm")).toBeNull();
        const dbProfile = profile({ archetypes: ["reanimator"] });
        const getProfileFn = resolveEventCardProfile(
            ["vintage-cube"],
            fakeDb({ "vintage-cube": { "worldspine-wurm": dbProfile } })
        );
        expect(getProfileFn("worldspine-wurm")).toEqual(dbProfile);
    });

    it("a multi-scope event resolves a profile from ANY of its distinct scopes", () => {
        const cubeProfile = profile({ archetypes: ["artifacts"] });
        const getProfileFn = resolveEventCardProfile(
            ["lea", "vintage-cube"],
            fakeDb({ "vintage-cube": { "some-cube-card": cubeProfile } })
        );
        expect(getProfileFn("some-cube-card")).toEqual(cubeProfile);
    });

    it("dedupes a repeated scope (a 3-round mono-set Draft's packSlots) without changing the result", () => {
        const p = profile({ archetypes: ["aggro"] });
        const getProfileFn = resolveEventCardProfile(
            ["lea", "lea", "lea"],
            fakeDb({ lea: { "card-x": p } })
        );
        expect(getProfileFn("card-x")).toEqual(p);
    });

    it("scope isolation: a profile in scope vintage-cube must not leak into scope lea (issue #1608 acceptance)", () => {
        const cubeProfile = profile({ archetypes: ["reanimator"] });
        const getProfileFn = resolveEventCardProfile(
            ["lea"],
            fakeDb({ "vintage-cube": { "shared-card-id": cubeProfile } })
        );
        expect(getProfileFn("shared-card-id")).toBeNull();
    });

    it("scope isolation the other direction: a profile in scope lea must not leak into scope vintage-cube", () => {
        const leaProfile = profile({ archetypes: ["aggro"] });
        const getProfileFn = resolveEventCardProfile(
            ["vintage-cube"],
            fakeDb({ lea: { "shared-card-id": leaProfile } })
        );
        expect(getProfileFn("shared-card-id")).toBeNull();
    });

    it("scope matching is case-insensitive (mirrors packSlots/cardRatings.ts discipline)", () => {
        const p = profile({ archetypes: ["control"] });
        const getProfileFn = resolveEventCardProfile(
            ["VINTAGE-CUBE"],
            fakeDb({ "vintage-cube": { "card-y": p } })
        );
        expect(getProfileFn("card-y")).toEqual(p);
    });

    it("preserves comboEdges when present on the resolved profile", () => {
        const p = profile({
            provides: [],
            requires: [],
            comboEdges: [{ cardId: "grindstone", weight: 5 }],
        });
        const getProfileFn = resolveEventCardProfile(
            ["vintage-cube"],
            fakeDb({ "vintage-cube": { "painters-servant": p } })
        );
        expect(getProfileFn("painters-servant")?.comboEdges).toEqual([
            { cardId: "grindstone", weight: 5 },
        ]);
    });

    it("preserves the reviewed flag verbatim (load-bearing for a later scoring slice, ADR 0072)", () => {
        const reviewedProfile = profile({ reviewed: true });
        const unreviewedProfile = profile({ reviewed: false });
        const getProfileFn = resolveEventCardProfile(
            ["vintage-cube"],
            fakeDb({
                "vintage-cube": {
                    "reviewed-card": reviewedProfile,
                    "unreviewed-card": unreviewedProfile,
                },
            })
        );
        expect(getProfileFn("reviewed-card")?.reviewed).toBe(true);
        expect(getProfileFn("unreviewed-card")?.reviewed).toBe(false);
    });
});

describe("getCardProfileFile / getCardProfile — seed layer (this slice ships zero checked-in data)", () => {
    it("returns null for every scope — no checked-in Card Profile file ships with this slice", () => {
        expect(getCardProfileFile("vintage-cube")).toBeNull();
        expect(getCardProfileFile("lea")).toBeNull();
        expect(getCardProfileFile("not-a-real-scope")).toBeNull();
    });

    it("getCardProfile falls through to null for every (scope, cardId)", () => {
        expect(getCardProfile("vintage-cube", "black-lotus")).toBeNull();
    });
});

describe("validateCardProfileFile — pure validator (issue #1608)", () => {
    it("an empty profiles map validates clean", () => {
        const file: CardProfileFile = { scope: "vintage-cube", profiles: {} };
        expect(validateCardProfileFile(file)).toEqual({ valid: true, errors: [] });
    });
});
