// "Play with the top card of your library revealed" (CR 401.5, CR 604.2) —
// the flat `revealsLibraryTop` scope the engine reads live off the battlefield.
//
//  1. GOLDEN fixture — a real corpus card compiled whole.
//  2. REFUSALS — the neighbours this rule does not read (state "unparsed").

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function goblinSpy(oracleText: string) {
    return oracleCard({
        name: "Goblin Spy",
        manaCost: "{R}",
        typeLine: "Creature — Goblin Rogue",
        oracleText,
        power: "1",
        toughness: "1",
    });
}

describe("Library-top reveal — golden fixture (CR 401.5)", () => {
    it("Goblin Spy", () => {
        const text = "Play with the top card of your library revealed.";
        const outcome = compileCard(goblinSpy(text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Goblin Spy",
                types: ["Creature"],
                subtypes: ["Goblin", "Rogue"],
                manaCost: { R: 1 },
                power: 1,
                toughness: 1,
                oracleText: text,
                revealsLibraryTop: "controller",
            })
        );
    });
});

describe("Library-top reveal — refusals (fail-closed)", () => {
    it.each([
        "Your opponents play with the top card of their libraries revealed.",
        "Players play with the top card of their libraries revealed.",
        "Play with the top card of your library revealed. You may look at it.",
        "Play with your hand revealed.",
    ])("refuses %s", (text) => {
        expect(compileCard(goblinSpy(text)).state).toBe("unparsed");
    });
});
