// Checked-in Booster Config registry tests (ADR 0055/0056/0059, issue #1110,
// #1242).
import { describe, it, expect } from "vitest";
import {
    getBoosterConfig,
    getPackSource,
    getRuntimeBoosterConfig,
    getSheetPrintCardId,
    isDraftableSet,
    listDraftableSets,
    listPackSources,
    resolveFeatureCardId,
    resolvePackSlots,
    type PackSourceEntry,
} from "../registry";
import { tryGetDefinition } from "../../cards";

describe("registry (ADR 0056/0059)", () => {
    it("resolves LEA's checked-in Booster Config", () => {
        const config = getBoosterConfig("lea");
        expect(config).not.toBeNull();
        expect(config!.setCode).toBe("lea");
    });

    it("is case-insensitive on the set code", () => {
        expect(getBoosterConfig("LEA")).not.toBeNull();
        expect(getBoosterConfig("Lea")).not.toBeNull();
    });

    it("returns null for a set with no checked-in config", () => {
        expect(getBoosterConfig("inv")).toBeNull();
    });

    it("LEA is Draftable", () => {
        expect(isDraftableSet("lea")).toBe(true);
    });

    it("an unregistered set is not Draftable", () => {
        expect(isDraftableSet("inv")).toBe(false);
    });

    it("ICE and DRK are checked in and Draftable under the per-sheet ≥80% gate (ADR 0059, PRD #1242)", () => {
        expect(getBoosterConfig("ice")).not.toBeNull();
        expect(getBoosterConfig("drk")).not.toBeNull();
        expect(isDraftableSet("ice")).toBe(true);
        expect(isDraftableSet("drk")).toBe(true);
    });

    it("lists every checked-in set with its Draftability, missing-card count, and per-sheet verdict", () => {
        const sets = listDraftableSets();
        expect(sets.length).toBeGreaterThan(0);
        const lea = sets.find((s) => s.setCode === "lea");
        expect(lea).toEqual({
            setCode: "lea",
            draftable: true,
            missingCardCount: 0,
            sheets: [
                { sheetName: "common", coverage: 1, passes: true },
                { sheetName: "rare", coverage: 1, passes: true },
                { sheetName: "uncommon", coverage: 1, passes: true },
            ],
        });
    });

    it("ICE and DRK show a positive missing-card count with a per-sheet breakdown (Incompleteness Notice source, PRD #1242 AC5)", () => {
        const sets = listDraftableSets();
        for (const code of ["ice", "drk"]) {
            const info = sets.find((s) => s.setCode === code);
            expect(info).toBeDefined();
            expect(info!.draftable).toBe(true);
            expect(info!.missingCardCount).toBeGreaterThan(0);
            expect(info!.sheets.length).toBeGreaterThan(0);
            for (const sheet of info!.sheets) {
                expect(sheet.passes).toBe(true);
                expect(sheet.coverage).toBeGreaterThanOrEqual(0.8);
            }
        }
    });

    describe("getRuntimeBoosterConfig (ADR 0059)", () => {
        it("returns null when there is no checked-in config", () => {
            expect(getRuntimeBoosterConfig("inv")).toBeNull();
        });

        it("drops every unimplemented Scryfall id from every sheet, read against the LIVE registry (never baked into checked-in JSON)", () => {
            const raw = getBoosterConfig("ice")!;
            const runtime = getRuntimeBoosterConfig("ice")!;

            for (const [sheetName, sheet] of Object.entries(runtime.sheets)) {
                for (const scryfallId of Object.keys(sheet.cards)) {
                    expect(
                        tryGetDefinition(
                            getSheetPrintCardId(scryfallId) ?? scryfallId
                        )
                    ).not.toBeNull();
                }
                // Every survivor is still present on the RAW sheet — nothing
                // invented, only removed.
                for (const scryfallId of Object.keys(sheet.cards)) {
                    expect(raw.sheets[sheetName].cards).toHaveProperty(
                        scryfallId
                    );
                }
            }

            // The raw checked-in config is untouched by this call (the drop
            // happens at read time, not baked into the JSON file).
            const rawAgain = getBoosterConfig("ice")!;
            expect(rawAgain).toEqual(raw);
        });

        it("renormalizes each sheet's totalWeight to match its surviving cards", () => {
            const runtime = getRuntimeBoosterConfig("drk")!;
            for (const sheet of Object.values(runtime.sheets)) {
                const sum = Object.values(sheet.cards).reduce(
                    (a, b) => a + b,
                    0
                );
                expect(sheet.totalWeight).toBe(sum);
            }
        });
    });
});

// Pack Source catalogue (PRD #5383, issue #5385).
describe("Pack Source catalogue (issue #5385)", () => {
    it("lists every source in its explicit order, Vintage Cube first, with key, name, description and Feature Card", () => {
        const sources = listPackSources();
        expect(
            sources.map(({ key, name, featureCardId }) => ({
                key,
                name,
                featureCardId,
            }))
        ).toEqual([
            {
                key: "vintage-cube",
                name: "Vintage Cube",
                featureCardId: "b0faa7f2-b547-42c4-a810-839da50dadfe",
            },
            {
                key: "lea",
                name: "Limited Edition Alpha",
                featureCardId: "82da0972-b17b-4600-9efd-e9430a0db04b",
            },
            {
                key: "ice",
                name: "Ice Age",
                featureCardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
            },
            {
                key: "drk",
                name: "The Dark",
                featureCardId: "42dcceee-2a47-4eaa-a6a3-2931b3d50244",
            },
        ]);
        for (const source of sources) {
            expect(source.description.length).toBeGreaterThan(0);
            expect(source.draftable).toBe(true);
            // Every Feature Card renders: it is an implemented card.
            expect(tryGetDefinition(source.featureCardId!)).not.toBeNull();
        }
        expect(sources[0].draftOnly).toBe(true);
        expect(sources.slice(1).every((s) => !s.draftOnly)).toBe(true);
    });

    it("annotates each source with the live Draftability of its sets", () => {
        const ice = listPackSources().find((s) => s.key === "ice")!;
        expect(ice.sets).toEqual([
            listDraftableSets().find((s) => s.setCode === "ice"),
        ]);
    });

    it("looks a source up by key, case-insensitively, and returns null for an unknown key", () => {
        expect(getPackSource("LEA")?.key).toBe("lea");
        expect(getPackSource("inv")).toBeNull();
    });

    describe("Feature Card fallback — the highest-Pick-Rating rare", () => {
        const LEA_RARES = Object.keys(
            getBoosterConfig("lea")!.sheets.rare.cards
        );
        const LEA_UNCOMMON = Object.keys(
            getBoosterConfig("lea")!.sheets.uncommon.cards
        )[0];
        const UNPICKED: PackSourceEntry = {
            key: "fixture",
            name: "Fixture",
            description: "No hand-picked Feature Card.",
            packs: ["lea", "lea", "lea"],
        };

        it("resolves to the rare with the highest Pick Rating, ignoring a higher-rated non-rare", () => {
            const best = LEA_RARES[7];
            const ratings: Record<string, number> = {
                [LEA_RARES[0]]: 3,
                [best]: 4.5,
                [LEA_RARES[12]]: 4,
                [LEA_UNCOMMON]: 5,
            };
            expect(
                resolveFeatureCardId(
                    UNPICKED,
                    (_set, cardId) => ratings[cardId] ?? null
                )
            ).toBe(best);
        });

        it("still names a rare when none is rated (lowest card id, stable)", () => {
            expect(resolveFeatureCardId(UNPICKED, () => null)).toBe(
                [...LEA_RARES].sort()[0]
            );
        });

        it("a hand-picked Feature Card wins over every rating", () => {
            expect(
                resolveFeatureCardId(
                    { ...UNPICKED, featureCardId: "hand-picked" },
                    () => 5
                )
            ).toBe("hand-picked");
        });
    });

    describe("resolvePackSlots", () => {
        const BLOCK: PackSourceEntry = {
            key: "fixture-block",
            name: "Fixture Block",
            description: "One set per pack.",
            packs: ["inv", "pls", "apc"],
        };

        it("a block sequence drafts one set per pack, in pack order", () => {
            expect(resolvePackSlots(BLOCK, "draft")).toEqual([
                "inv",
                "pls",
                "apc",
            ]);
        });

        it("Sealed cycles each distinct set once", () => {
            expect(resolvePackSlots(BLOCK, "sealed")).toEqual([
                "inv",
                "pls",
                "apc",
            ]);
            expect(resolvePackSlots(getPackSource("lea")!, "sealed")).toEqual([
                "lea",
            ]);
        });

        it("a single-set source drafts three boosters of that set", () => {
            expect(resolvePackSlots(getPackSource("drk")!, "draft")).toEqual([
                "drk",
                "drk",
                "drk",
            ]);
        });
    });
});
