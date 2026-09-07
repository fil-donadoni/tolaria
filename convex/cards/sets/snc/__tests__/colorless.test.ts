// SNC (Streets of New Capenna) — colorless: the five Triomes (issue #689).
// Cycling is exercised end-to-end in convex/gre/__tests__/cycling.test.ts;
// these tests lock the `makeTriome` factory output for each card.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../../types";
import { getDefinition } from "../../../index";

const jetmirsGarden = getDefinition("26d40e03-6de4-4373-9fbf-04c1dd79e995");
const xandersLounge = getDefinition("54f449ff-4025-465e-9ec5-a5cf42c4c9d3");
const sparasHeadquarters = getDefinition(
    "7363f1fb-9af3-4212-921f-d59533faf0e5"
);
const ziatorasProvingGround = getDefinition(
    "75fdce80-e338-4a50-bdc6-786511feaeef"
);
const raffinesTower = getDefinition("a2c56479-4bee-4edb-80d7-4af010b7c793");

function expectTriome(
    card: CardDefinition,
    subtypes: string[],
    colors: string[]
) {
    expect(card.types).toEqual(["Land"]);
    expect(card.subtypes).toEqual(subtypes);
    expect(card.entersTapped).toBe(true);
    const mana = card.activatedAbilities?.find((a) => a.id.endsWith("-mana"));
    expect(mana?.useStack).toBe(false);
    expect(mana?.manaChoices).toEqual(colors.map((c) => ({ [c]: 1 })));
    const cycling = card.activatedAbilities?.find((a) => a.id === "cycling");
    expect(cycling?.activateFromHand).toBe(true);
    expect(cycling?.cost.discardThis).toBe(true);
    expect(cycling?.cost.mana).toEqual({ generic: 3 });
}

describe("SNC Triomes (CR 702.29 Cycling, CR 305.6 nonbasic land)", () => {
    it("Jetmir's Garden — Mountain Forest Plains, taps R/G/W", () => {
        expectTriome(
            jetmirsGarden,
            ["Mountain", "Forest", "Plains"],
            ["R", "G", "W"]
        );
    });
    it("Xander's Lounge — Island Swamp Mountain, taps U/B/R", () => {
        expectTriome(
            xandersLounge,
            ["Island", "Swamp", "Mountain"],
            ["U", "B", "R"]
        );
    });
    it("Spara's Headquarters — Forest Plains Island, taps G/W/U", () => {
        expectTriome(
            sparasHeadquarters,
            ["Forest", "Plains", "Island"],
            ["G", "W", "U"]
        );
    });
    it("Ziatora's Proving Ground — Swamp Mountain Forest, taps B/R/G", () => {
        expectTriome(
            ziatorasProvingGround,
            ["Swamp", "Mountain", "Forest"],
            ["B", "R", "G"]
        );
    });
    it("Raffine's Tower — Plains Island Swamp, taps W/U/B", () => {
        expectTriome(
            raffinesTower,
            ["Plains", "Island", "Swamp"],
            ["W", "U", "B"]
        );
    });
});
