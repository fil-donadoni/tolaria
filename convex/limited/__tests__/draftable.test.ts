// Draftable-Set gate tests (ADR 0059, supersedes ADR 0056; PRD #1242). LEA —
// checked-in Booster Config, ADR exclusions already stripped at import time —
// must compute as fully Draftable. A partial set (INV: the catalogue census
// is far from complete, per `project_inv_batch_plan` — INV isn't a shipped
// Draftable Set config, so its Booster Config is built in-memory here
// straight from the vendored MTGJSON snapshot via the same pure transform
// the importer uses) must compute as NOT Draftable under the per-sheet ≥80%
// gate, with the missing cards reported per sheet.
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import invRaw from "../../../data/json/INV.json";
import { computeDraftability, dropUnimplementedCards } from "../draftable";
import { buildBoosterConfig, type MtgjsonSetData } from "../mtgjsonImport";
import { tryGetDefinition } from "../../cards";
import type { BoosterConfig } from "../boosterTypes";

const leaConfig = leaConfigJson as BoosterConfig;

describe("computeDraftability (ADR 0059 — per-sheet ≥80%)", () => {
    it("LEA (complete minus ADR 0010 exclusions) is Draftable, every sheet at 100%", () => {
        const result = computeDraftability(leaConfig);
        expect(result.draftable).toBe(true);
        expect(result.missingCardIds).toEqual([]);
        for (const sheet of result.sheets) {
            expect(sheet.coverage).toBe(1);
            expect(sheet.passes).toBe(true);
        }
    });

    it("a partial set (INV) is NOT Draftable, and reports the missing cards per sheet", () => {
        const invConfig = buildBoosterConfig(
            invRaw.data as unknown as MtgjsonSetData,
            { boosterType: "draft" }
        );
        const result = computeDraftability(invConfig);

        expect(result.draftable).toBe(false);
        expect(result.missingCardIds.length).toBeGreaterThan(0);
        expect(result.sheets.some((s) => !s.passes)).toBe(true);
        // Every reported id must actually be a member of the config's own
        // sheets — the reason has to point at a real gap, not noise.
        const allSheetIds = new Set(
            Object.values(invConfig.sheets).flatMap((sheet) =>
                Object.keys(sheet.cards)
            )
        );
        for (const id of result.missingCardIds) {
            expect(allSheetIds.has(id)).toBe(true);
        }
    });

    it("is mechanical, not a hand-maintained whitelist: an empty-sheets config is trivially Draftable", () => {
        const empty: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: {}, weight: 1 }],
            sheets: {},
        };
        expect(computeDraftability(empty)).toEqual({
            draftable: true,
            missingCardIds: [],
            sheets: [],
        });
    });

    it("flags a single unimplemented card by its Scryfall id", () => {
        const config: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: { common: 1 }, weight: 1 }],
            sheets: {
                common: {
                    totalWeight: 1,
                    cards: { "not-a-real-scryfall-id": 1 },
                },
            },
        };
        const result = computeDraftability(config);
        expect(result.draftable).toBe(false);
        expect(result.missingCardIds).toEqual(["not-a-real-scryfall-id"]);
        expect(result.sheets).toEqual([
            {
                sheetName: "common",
                totalCards: 1,
                missingCardIds: ["not-a-real-scryfall-id"],
                coverage: 0,
                passes: false,
            },
        ]);
    });

    it("PER-SHEET, never a per-set average: one sheet under 80% fails the whole set even though the OTHER sheet is 100% (average would be 90%)", () => {
        // 10-card "common" sheet, fully implemented (LEA commons); a
        // synthetic "rare" sheet at exactly 1 real id + 9 fake ones (10%
        // coverage). Per-set average = (10 + 1) / 20 = 55%... use numbers
        // that make the AVERAGE clear 80% while the WEAK sheet alone is not:
        // common 10/10 (100%), rare 6/10 real, 4 fake (60%) → average
        // (10+6)/20 = 80% exactly, which a per-set-average gate would admit,
        // but the per-sheet gate must still reject on the rare sheet's 60%.
        const realIds = Object.keys(leaConfig.sheets.common.cards).slice(0, 10);
        expect(realIds.length).toBe(10);
        for (const id of realIds) {
            expect(tryGetDefinition(id)).not.toBeNull();
        }
        const rareRealIds = Object.keys(leaConfig.sheets.rare.cards).slice(
            0,
            6
        );
        expect(rareRealIds.length).toBe(6);

        const config: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: { common: 1, rare: 1 }, weight: 1 }],
            sheets: {
                common: {
                    totalWeight: 10,
                    cards: Object.fromEntries(realIds.map((id) => [id, 1])),
                },
                rare: {
                    totalWeight: 10,
                    cards: {
                        ...Object.fromEntries(rareRealIds.map((id) => [id, 1])),
                        fake1: 1,
                        fake2: 1,
                        fake3: 1,
                        fake4: 1,
                    },
                },
            },
        };

        const result = computeDraftability(config);
        const commonSheet = result.sheets.find(
            (s) => s.sheetName === "common"
        )!;
        const rareSheet = result.sheets.find((s) => s.sheetName === "rare")!;
        expect(commonSheet.coverage).toBe(1);
        expect(commonSheet.passes).toBe(true);
        expect(rareSheet.coverage).toBe(0.6);
        expect(rareSheet.passes).toBe(false);
        // The whole-set average would be 80% ((10+6)/20) — a per-set-average
        // gate would admit this. The per-sheet gate must NOT.
        expect(result.draftable).toBe(false);
    });
});

describe("dropUnimplementedCards (ADR 0059)", () => {
    it("drops unimplemented ids from every sheet and renormalizes weight, read against the LIVE registry", () => {
        const config: BoosterConfig = {
            setCode: "tst",
            boostersTotalWeight: 1,
            boosters: [{ contents: { common: 2 }, weight: 1 }],
            sheets: {
                common: {
                    totalWeight: 4,
                    cards: {
                        [Object.keys(leaConfig.sheets.common.cards)[0]]: 3,
                        "not-a-real-scryfall-id": 1,
                    },
                },
            },
        };

        const { config: dropped, missingCardIds } =
            dropUnimplementedCards(config);

        expect(missingCardIds).toEqual(["not-a-real-scryfall-id"]);
        expect(dropped.sheets.common.cards).not.toHaveProperty(
            "not-a-real-scryfall-id"
        );
        expect(dropped.sheets.common.totalWeight).toBe(3);
        expect(
            dropped.sheets.common.cards[
                Object.keys(leaConfig.sheets.common.cards)[0]
            ]
        ).toBe(3);

        // Never mutates the input config.
        expect(config.sheets.common.cards).toHaveProperty(
            "not-a-real-scryfall-id"
        );
    });

    it("is a no-op on a fully-implemented config (LEA)", () => {
        const { config: dropped, missingCardIds } =
            dropUnimplementedCards(leaConfig);
        expect(missingCardIds).toEqual([]);
        expect(dropped).toEqual(leaConfig);
    });
});
