// Draftable-Set gate tests (ADR 0056). LEA — checked-in Booster Config, ADR
// exclusions already stripped at import time — must compute as fully
// Draftable. A partial set (INV: the catalogue census is far from complete,
// per `project_inv_batch_plan` — INV isn't a shipped Draftable Set config, so
// its Booster Config is built in-memory here straight from the vendored
// MTGJSON snapshot via the same pure transform the importer uses) must
// compute as NOT Draftable, with the missing cards reported.
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import invRaw from "../../../data/json/INV.json";
import { computeDraftability } from "../draftable";
import { buildBoosterConfig, type MtgjsonSetData } from "../mtgjsonImport";
import type { BoosterConfig } from "../boosterTypes";

const leaConfig = leaConfigJson as BoosterConfig;

describe("computeDraftability (ADR 0056)", () => {
    it("LEA (complete minus ADR 0010 exclusions) is Draftable", () => {
        const result = computeDraftability(leaConfig);
        expect(result.draftable).toBe(true);
        expect(result.missingCardIds).toEqual([]);
    });

    it("a partial set (INV) is NOT Draftable, and reports the missing cards", () => {
        const invConfig = buildBoosterConfig(
            invRaw.data as unknown as MtgjsonSetData,
            { boosterType: "draft" }
        );
        const result = computeDraftability(invConfig);

        expect(result.draftable).toBe(false);
        expect(result.missingCardIds.length).toBeGreaterThan(0);
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
    });
});
