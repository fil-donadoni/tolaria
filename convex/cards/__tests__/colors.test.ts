import { describe, expect, it } from "vitest";
import {
    basicLandsForColors,
    cardHasColor,
    getCardColorIdentity,
    getCardColors,
    getColorsFromCost,
    getPipCountsFromCost,
} from "../colors";
import type { CardDefinition } from "../types";

describe("getPipCountsFromCost (ADR 0073, issue #1610 — Colour Commitment pip weighting)", () => {
    it("returns empty for undefined cost", () => {
        expect(getPipCountsFromCost(undefined)).toEqual({});
    });

    it("ignores generic mana (X) and colorless (C)", () => {
        expect(getPipCountsFromCost({ X: 3, C: 2 })).toEqual({});
    });

    it("counts a single coloured pip", () => {
        expect(getPipCountsFromCost({ R: 1 })).toEqual({ R: 1 });
    });

    it("counts a DOUBLE pip, distinguishing it from a single pip — {U}{U} is 2, {4}{U} is 1", () => {
        expect(getPipCountsFromCost({ U: 2 })).toEqual({ U: 2 });
        expect(getPipCountsFromCost({ generic: 4, U: 1 })).toEqual({ U: 1 });
    });

    it("counts every coloured pip in a multicolour cost independently", () => {
        expect(getPipCountsFromCost({ W: 1, U: 2, generic: 1 })).toEqual({
            W: 1,
            U: 2,
        });
    });

    it("counts a Phyrexian pip (CR 105.2) the same as a normal pip", () => {
        expect(getPipCountsFromCost({ phyrexian: { U: 1 } })).toEqual({ U: 1 });
        // A normal pip and a Phyrexian pip of the same colour SUM.
        expect(getPipCountsFromCost({ U: 1, phyrexian: { U: 1 } })).toEqual({
            U: 2,
        });
    });
});

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

describe("getCardColors (CR 105.2 / 202.2 — actual card colour)", () => {
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

    it("a basic land is COLOURLESS — it taps for a colour but has no cost", () => {
        const def = stub({
            id: "island",
            name: "Island",
            types: ["Land"],
            subtypes: ["Island"],
            manaCost: undefined,
        });
        expect(getCardColors(def)).toEqual([]);
    });
});

describe("getCardColorIdentity (deck-builder / draft identity)", () => {
    const stub = (overrides: Partial<CardDefinition>): CardDefinition => ({
        id: "stub",
        name: "Stub",
        rarity: "common",
        types: ["Creature"],
        ...overrides,
    });

    it("derives from manaCost when present", () => {
        const def = stub({ manaCost: { R: 1, W: 1 } });
        expect(getCardColorIdentity(def)).toEqual(["W", "R"]);
    });

    it("returns empty for vanilla colorless creature with no cost", () => {
        const def = stub({ types: ["Creature"], manaCost: undefined });
        expect(getCardColorIdentity(def)).toEqual([]);
    });

    it("derives basic land color from subtype (Island's identity IS blue)", () => {
        const def = stub({
            id: "plains",
            name: "Plains",
            types: ["Land"],
            subtypes: ["Plains"],
            manaCost: undefined,
        });
        expect(getCardColorIdentity(def)).toEqual(["W"]);
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
        expect(getCardColorIdentity(def)).toEqual(["B", "R"]);
    });
});

describe("cardHasColor (CR 105.2 / 202.2 — actual card colour, not identity)", () => {
    const stub = (overrides: Partial<CardDefinition>): CardDefinition => ({
        id: "stub",
        name: "Stub",
        rarity: "common",
        types: ["Creature"],
        ...overrides,
    });

    it("matches the colour of a coloured card's mana cost", () => {
        const snap = stub({ manaCost: { generic: 1, U: 1 } });
        expect(cardHasColor(snap, "U")).toBe(true);
        expect(cardHasColor(snap, "R")).toBe(false);
    });

    it("an Island is COLOURLESS — never blue — even though it taps for blue (the bug)", () => {
        const island = stub({
            id: "island",
            name: "Island",
            types: ["Land"],
            subtypes: ["Island"],
            manaCost: undefined,
        });
        // getCardColorIdentity (deck-builder IDENTITY) folds the produced mana
        // in — Island's identity is blue...
        expect(getCardColorIdentity(island)).toEqual(["U"]);
        // ...but the card's actual COLOUR is empty: getCardColors returns [] and
        // it must NOT pay "exile a blue card" (CR 105.2a).
        expect(getCardColors(island)).toEqual([]);
        expect(cardHasColor(island, "U")).toBe(false);
    });

    it("an artifact with a colourless cost has no colour", () => {
        const artifact = stub({
            id: "moxen",
            types: ["Artifact"],
            manaCost: { generic: 0 },
        });
        expect(cardHasColor(artifact, "U")).toBe(false);
    });
});

describe("basicLandsForColors (debug scenario land seeding)", () => {
    it("falls back to Plains for an empty/colorless board", () => {
        expect(basicLandsForColors([])).toEqual(["Plains"]);
        expect(basicLandsForColors(["C"])).toEqual(["Plains"]);
    });

    it("maps a single color to its basic land", () => {
        expect(basicLandsForColors(["R"])).toEqual(["Mountain"]);
        expect(basicLandsForColors(["G"])).toEqual(["Forest"]);
    });

    it("returns basics in canonical WUBRG order regardless of input order", () => {
        expect(basicLandsForColors(["U", "W"])).toEqual(["Plains", "Island"]);
        expect(basicLandsForColors(["G", "B", "W"])).toEqual([
            "Plains",
            "Swamp",
            "Forest",
        ]);
    });

    it("dedupes repeated colors", () => {
        expect(basicLandsForColors(["R", "R"])).toEqual(["Mountain"]);
    });
});
