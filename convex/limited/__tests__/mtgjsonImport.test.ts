// Pure MTGJSON → Booster Config transform tests (ADR 0056). Covers the
// synthetic-fixture edge cases (foil-slot dropping, ADR-exclusion
// renormalization, missing-scryfallId errors) plus one real-data assertion
// against the vendored LEA snapshot, so the transform is proven both in
// isolation and against the actual data the import script runs on.
import { describe, it, expect } from "vitest";
import leaRaw from "../../../data/json/LEA.json";
import { buildBoosterConfig, type MtgjsonSetData } from "../mtgjsonImport";

function fixtureSet(overrides: Partial<MtgjsonSetData> = {}): MtgjsonSetData {
    return {
        code: "TST",
        cards: [
            { uuid: "u-common-a", identifiers: { scryfallId: "sf-common-a" } },
            { uuid: "u-common-b", identifiers: { scryfallId: "sf-common-b" } },
            { uuid: "u-rare-a", identifiers: { scryfallId: "sf-rare-a" } },
            {
                uuid: "u-rare-excluded",
                identifiers: { scryfallId: "sf-excluded" },
            },
            {
                uuid: "u-foil-only",
                identifiers: { scryfallId: "sf-foil-only" },
            },
        ],
        booster: {
            default: {
                boostersTotalWeight: 1,
                boosters: [{ contents: { common: 2, rare: 1 }, weight: 1 }],
                sheets: {
                    common: {
                        totalWeight: 3,
                        cards: { "u-common-a": 1, "u-common-b": 2 },
                    },
                    rare: {
                        totalWeight: 2,
                        cards: { "u-rare-a": 1, "u-rare-excluded": 1 },
                    },
                },
            },
        },
        ...overrides,
    };
}

describe("buildBoosterConfig (ADR 0056)", () => {
    it("maps MTGJSON uuids to Scryfall ids on every sheet", () => {
        const config = buildBoosterConfig(fixtureSet(), {
            boosterType: "default",
            excludedScryfallIds: new Set(),
        });
        expect(Object.keys(config.sheets.common.cards).sort()).toEqual([
            "sf-common-a",
            "sf-common-b",
        ]);
        expect(config.sheets.common.cards["sf-common-b"]).toBe(2);
    });

    it("strips ADR-excluded cards and renormalizes the sheet's totalWeight", () => {
        const config = buildBoosterConfig(fixtureSet(), {
            boosterType: "default",
            excludedScryfallIds: new Set(["sf-excluded"]),
        });
        expect(config.sheets.rare.cards).toEqual({ "sf-rare-a": 1 });
        // Renormalized: was 2 (1 + 1), now just the surviving entry's weight.
        expect(config.sheets.rare.totalWeight).toBe(1);
    });

    it("drops foil sheets and any booster variant that references one", () => {
        const raw = fixtureSet({
            booster: {
                default: {
                    boostersTotalWeight: 3,
                    boosters: [
                        { contents: { common: 2, rare: 1 }, weight: 2 },
                        {
                            contents: { common: 2, rare: 1, foilBonus: 1 },
                            weight: 1,
                        },
                    ],
                    sheets: {
                        common: {
                            totalWeight: 3,
                            cards: { "u-common-a": 1, "u-common-b": 2 },
                        },
                        rare: {
                            totalWeight: 2,
                            cards: { "u-rare-a": 1, "u-rare-excluded": 1 },
                        },
                        foilBonus: {
                            totalWeight: 1,
                            cards: { "u-foil-only": 1 },
                            foil: true,
                        },
                    },
                },
            },
        });

        const config = buildBoosterConfig(raw, {
            boosterType: "default",
            excludedScryfallIds: new Set(),
        });

        expect(Object.keys(config.sheets)).not.toContain("foilBonus");
        // Only the non-foil variant survives — weight renormalized to its own.
        expect(config.boosters).toHaveLength(1);
        expect(config.boosters[0].contents).toEqual({ common: 2, rare: 1 });
        expect(config.boostersTotalWeight).toBe(2);
    });

    it("throws when a sheet card has no identifiers.scryfallId", () => {
        const raw = fixtureSet({
            cards: [
                { uuid: "u-common-a", identifiers: {} },
                {
                    uuid: "u-common-b",
                    identifiers: { scryfallId: "sf-common-b" },
                },
                { uuid: "u-rare-a", identifiers: { scryfallId: "sf-rare-a" } },
                {
                    uuid: "u-rare-excluded",
                    identifiers: { scryfallId: "sf-excluded" },
                },
            ],
        });
        expect(() =>
            buildBoosterConfig(raw, {
                boosterType: "default",
                excludedScryfallIds: new Set(),
            })
        ).toThrow(/no identifiers.scryfallId/);
    });

    it("throws for an unknown booster type", () => {
        expect(() =>
            buildBoosterConfig(fixtureSet(), { boosterType: "collector" })
        ).toThrow(/no booster\."collector"/);
    });

    it("defaults excludedScryfallIds to the ADR 0010 exclusion list", () => {
        // sf-excluded isn't one of the real ADR ids, so with the default
        // exclusion set it survives — proves the default parameter is wired,
        // not a hardcoded empty set.
        const config = buildBoosterConfig(fixtureSet(), {
            boosterType: "default",
        });
        expect(config.sheets.rare.cards).toHaveProperty("sf-excluded");
    });

    it("real data: LEA's booster.default strips exactly the 4 ADR 0010 exclusions from the rare sheet", () => {
        const config = buildBoosterConfig(leaRaw.data as MtgjsonSetData, {
            boosterType: "default",
        });

        expect(config.setCode).toBe("lea");
        expect(config.boosters).toEqual([
            { contents: { common: 11, rare: 1, uncommon: 3 }, weight: 1 },
        ]);
        // MTGJSON's rare sheet declares 118 cards / totalWeight 121 before
        // ADR stripping; the 4 exclusions are all weight-1 rares.
        expect(Object.keys(config.sheets.rare.cards)).toHaveLength(114);
        expect(config.sheets.rare.totalWeight).toBe(117);
        for (const excludedId of [
            "9853b0ce-4763-4877-9741-f9145a3659c6", // Contract from Below
            "e78db688-93a2-47f5-9aa5-9158a72cd973", // Darkpact
            "fd891fc6-d9d6-494e-ae65-8bea8f44b575", // Demonic Attorney
            "92274971-7c4a-4326-b0fe-75e2d124f718", // Chaos Orb
        ]) {
            expect(config.sheets.rare.cards).not.toHaveProperty(excludedId);
        }
        // Basics live on the common sheet (PRD #1107 design note).
        expect(config.sheets.common.cards).toHaveProperty(
            "78a9088f-8755-47cb-aa93-51d992ccab90" // arbitrary known LEA common (Hurloon Minotaur), sanity-checks the uuid→scryfallId mapping
        );
    });

    it("is deterministic: repeated calls on the same input produce the same output", () => {
        const raw = fixtureSet();
        const a = buildBoosterConfig(raw, { boosterType: "default" });
        const b = buildBoosterConfig(raw, { boosterType: "default" });
        expect(a).toEqual(b);
    });
});
