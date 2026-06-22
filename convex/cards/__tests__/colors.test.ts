import { describe, expect, it } from "vitest";
import { getCardColors, getColorsFromCost } from "../colors";
import type { CardDefinition } from "../types";

describe("getColorsFromCost", () => {
    it("returns empty for undefined cost", () => {
        expect(getColorsFromCost(undefined)).toEqual([]);
    });

    it("ignores generic mana (X) and colorless (C)", () => {
        expect(getColorsFromCost({ X: 3, C: 2 })).toEqual([]);
    });

    it("returns single color for monocolor cost", () => {
        expect(getColorsFromCost({ R: 1 })).toEqual(["R"]);
        expect(getColorsFromCost({ X: 3, U: 2 })).toEqual(["U"]);
    });

    it("returns multiple colors in WUBRG canonical order", () => {
        expect(getColorsFromCost({ R: 1, W: 1 })).toEqual(["W", "R"]);
        expect(getColorsFromCost({ G: 1, U: 1, B: 1 })).toEqual([
            "U",
            "B",
            "G",
        ]);
    });
});

describe("getCardColors", () => {
    const stub = (overrides: Partial<CardDefinition>): CardDefinition => ({
        id: "stub",
        name: "Stub",
        rarity: "common",
        types: ["Creature"],
        ...overrides,
    });

    it("derives from manaCost when present", () => {
        const def = stub({ manaCost: { R: 1, W: 1 } });
        expect(getCardColors(def)).toEqual(["W", "R"]);
    });

    it("returns empty for vanilla colorless creature with no cost", () => {
        const def = stub({ types: ["Creature"], manaCost: undefined });
        expect(getCardColors(def)).toEqual([]);
    });

    it("derives basic land color from subtype", () => {
        const def = stub({
            id: "plains",
            name: "Plains",
            types: ["Land"],
            subtypes: ["Plains"],
            manaCost: undefined,
        });
        expect(getCardColors(def)).toEqual(["W"]);
    });

    it("derives dual land colors from subtypes plus mana choices", () => {
        const def = stub({
            id: "badlands",
            name: "Badlands",
            types: ["Land"],
            subtypes: ["Swamp", "Mountain"],
            manaCost: undefined,
            activatedAbilities: [
                {
                    id: "badlands-mana",
                    oracleText: "{T}: Add {B} or {R}.",
                    cost: { tap: true },
                    useStack: false,
                    manaChoices: [{ B: 1 }, { R: 1 }],
                },
            ],
        });
        expect(getCardColors(def)).toEqual(["B", "R"]);
    });
});
