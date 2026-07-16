// Checked-in Booster Config registry tests (ADR 0055/0056/0059, issue #1110,
// #1242).
import { describe, it, expect } from "vitest";
import {
    getBoosterConfig,
    getRuntimeBoosterConfig,
    isDraftableSet,
    listDraftableSets,
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
                    expect(tryGetDefinition(scryfallId)).not.toBeNull();
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
