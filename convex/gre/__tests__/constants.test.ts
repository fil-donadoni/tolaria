import { describe, it, expect } from "vitest";
import {
    isTapLockedBySummoningSickness,
    manaValue,
    getDefinitionProducibleColors,
    getProducibleColors,
} from "../constants";
import { makeInstance } from "../../cards/__tests__/setup";
import { getCardByName, getDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

describe("manaValue (CR 202.3)", () => {
    it("returns 0 when cost is undefined (lands)", () => {
        expect(manaValue(undefined)).toBe(0);
    });

    it("sums a single colored pip", () => {
        expect(manaValue({ R: 1 })).toBe(1);
    });

    it("sums generic and colored together (Serra Angel)", () => {
        expect(manaValue({ X: 3, W: 1 })).toBe(4);
    });

    it("treats string X as 0 (variable cost not committed)", () => {
        expect(manaValue({ X: "X", R: 1 })).toBe(1);
    });

    it("sums 4 generic + 2 green (Craw Wurm)", () => {
        expect(manaValue({ X: 4, G: 2 })).toBe(6);
    });

    it("returns 0 for the empty cost (Mox)", () => {
        expect(manaValue({})).toBe(0);
    });
});

describe("getDefinitionProducibleColors (CR 106.4, ADR 0073 issue #1610, from-name variant)", () => {
    it("reads a Mox's colour off its ability, not its (empty) mana cost — the bug ADR 0073 fixes", () => {
        // Mox Ruby: manaCost { X: 0 } — truthy, so the mana-cost-derived
        // `colors`/`getCardColorIdentity` short-circuits to `[]`. Fixing
        // Value/Castability (`convex/limited/botDrafter.ts`) need the colour
        // it actually PRODUCES instead.
        const moxRuby = getCardByName("Mox Ruby");
        expect([...getDefinitionProducibleColors(moxRuby)]).toEqual(["R"]);
    });

    it("reads a dual land's two colours off its subtypes + manaChoices ability", () => {
        const volcanicIsland = getCardByName("Volcanic Island");
        expect(
            [...getDefinitionProducibleColors(volcanicIsland)].sort()
        ).toEqual(["R", "U"]);
    });

    it("reads a basic land's single colour off its subtype alone", () => {
        const forest = getCardByName("Forest");
        expect([...getDefinitionProducibleColors(forest)]).toEqual(["G"]);
    });

    it("returns empty for a card with no mana-producing ability", () => {
        const bears = getCardByName("Grizzly Bears");
        expect([...getDefinitionProducibleColors(bears)]).toEqual([]);
    });

    it("excludes {C} — colourless is not a colour (CR 202.2, 106.1b)", () => {
        const stub: CardDefinition = {
            id: "stub-colorless-source",
            name: "Stub Colorless Source",
            rarity: "common",
            types: ["Artifact"],
            manaCost: { generic: 1 },
            activatedAbilities: [
                {
                    id: "stub-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
            ],
        };
        expect([...getDefinitionProducibleColors(stub)]).toEqual([]);
    });

    it("skips a useStack ability — not a mana ability (CR 605.1a)", () => {
        const stub: CardDefinition = {
            id: "stub-useStack-source",
            name: "Stub UseStack Source",
            rarity: "common",
            types: ["Artifact"],
            manaCost: { generic: 1 },
            activatedAbilities: [
                {
                    id: "stub-mana",
                    oracleText: "{2}, {T}: Add {U}.",
                    cost: { tap: true },
                    useStack: true,
                    manaProduced: { U: 1 },
                },
            ],
        };
        expect([...getDefinitionProducibleColors(stub)]).toEqual([]);
    });
});

describe("isTapLockedBySummoningSickness (CR 302.1)", () => {
    it("locks a creature with summoning sickness", () => {
        const card = makeInstance("55fe6449-1f23-43dc-adee-d144cd505b5c", {
            isSummoningSick: true,
        });
        expect(isTapLockedBySummoningSickness(card)).toBe(true);
    });

    it("does not lock a creature without summoning sickness", () => {
        const card = makeInstance("55fe6449-1f23-43dc-adee-d144cd505b5c", {
            isSummoningSick: false,
        });
        expect(isTapLockedBySummoningSickness(card)).toBe(false);
    });

    it("never locks a non-creature even when flagged sick", () => {
        // Mox Sapphire (artifact) — summoning sickness only applies to
        // creatures (CR 302.1). Mana abilities of non-creature permanents
        // are usable on the turn they ETB.
        const mox = makeInstance("82da0972-b17b-4600-9efd-e9430a0db04b", {
            isSummoningSick: true,
        });
        expect(isTapLockedBySummoningSickness(mox)).toBe(false);
    });

    it("does not lock a summoning-sick creature with haste (CR 702.10b)", () => {
        // Haste lets a creature pay {T}/{Q} the turn it arrives, exactly as it
        // lets it attack. Reads `staticAbilities`, so `grantAbility`-granted
        // haste (Ray of Command) counts the same as printed haste.
        const card = makeInstance("55fe6449-1f23-43dc-adee-d144cd505b5c", {
            isSummoningSick: true,
            staticAbilities: ["haste"],
        });
        expect(isTapLockedBySummoningSickness(card)).toBe(false);
    });
});

// CR 106.4 — "could produce": the set of colors a source could add regardless
// of what's actually chosen at activation time. `getDefinitionProducibleColors`
// is the definition-level twin (issue #1619, PRD #1617) answering this off a
// `CardDefinition` alone (deck/pool analysis, no game/battlefield instance
// required); `getProducibleColors` is the instance-level original it's
// expressed in terms of. Every case below asserts the definition-level result
// against the SAME expectation the instance-level function gives for the
// equivalent battlefield instance, so the two can't silently diverge.
describe("getDefinitionProducibleColors (CR 106.4)", () => {
    it("mono-color mana dork — Llanowar Elves produces its one color", () => {
        const id = "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb"; // Llanowar Elves
        const def = getDefinition(id);
        expect([...getDefinitionProducibleColors(def)].sort()).toEqual(["G"]);
        // Agrees with the instance-level twin for the equivalent instance.
        expect([...getProducibleColors(makeInstance(id))].sort()).toEqual([
            "G",
        ]);
    });

    it("multi-color source — Tropical Island (dual land) produces both colors", () => {
        const id = "a9c6c759-aabf-44e7-ba8c-33c5df232b56"; // Tropical Island
        const def = getDefinition(id);
        expect([...getDefinitionProducibleColors(def)].sort()).toEqual([
            "G",
            "U",
        ]);
        expect([...getProducibleColors(makeInstance(id))].sort()).toEqual([
            "G",
            "U",
        ]);
    });

    it("multi-color source — Chrome Mox (any-color mana rock) produces all five colors via its manaChoices fallback", () => {
        const id = "6a058e68-70af-4a64-859c-c881e5578368"; // Chrome Mox
        const def = getDefinition(id);
        const expected = ["B", "G", "R", "U", "W"];
        expect([...getDefinitionProducibleColors(def)].sort()).toEqual(
            expected
        );
        expect([...getProducibleColors(makeInstance(id))].sort()).toEqual(
            expected
        );
    });

    it("basic land by subtype — Forest produces green with no activated ability contribution", () => {
        const id = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // Forest
        const def = getDefinition(id);
        expect([...getDefinitionProducibleColors(def)].sort()).toEqual(["G"]);
        expect([...getProducibleColors(makeInstance(id))].sort()).toEqual([
            "G",
        ]);
    });

    it("no mana ability — Craw Wurm (vanilla creature) produces no colors", () => {
        const id = "bfed1a95-bd67-4e16-a781-81866028af2f"; // Craw Wurm
        const def = getDefinition(id);
        expect(getDefinitionProducibleColors(def).size).toBe(0);
        expect(getProducibleColors(makeInstance(id)).size).toBe(0);
    });
});
