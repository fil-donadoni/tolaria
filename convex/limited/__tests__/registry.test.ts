// Checked-in Booster Config registry tests (ADR 0055/0056, issue #1110).
import { describe, it, expect } from "vitest";
import {
    getBoosterConfig,
    isDraftableSet,
    listDraftableSets,
} from "../registry";

describe("registry (ADR 0056)", () => {
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

    it("lists every checked-in set with its Draftability and missing-card count", () => {
        const sets = listDraftableSets();
        expect(sets.length).toBeGreaterThan(0);
        const lea = sets.find((s) => s.setCode === "lea");
        expect(lea).toEqual({
            setCode: "lea",
            draftable: true,
            missingCardCount: 0,
        });
    });
});
