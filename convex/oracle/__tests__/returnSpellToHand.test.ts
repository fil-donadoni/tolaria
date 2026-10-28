// "Return target spell to its owner's hand." (CR 400.7, CR 112.1, issue #4532).
//
//  1. GOLDEN forms — real corpus cards compiled whole produce `moveSpellFromStack`
//     over the announced spell slot, destination hand (never `counter`: CR 701.6a
//     cancels a spell, a bounce does not).
//  2. REFUSALS — neighbours this rule must NOT read: a restricted spell, a
//     spell-or-permanent union, a spell sent to a library.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

describe("return target spell to its owner's hand (CR 400.7)", () => {
    it("compiles Reprieve whole", () => {
        const text = "Return target spell to its owner's hand.\nDraw a card.";
        const outcome = compileCard(instant("Reprieve", "{2}{W}", text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Reprieve",
                types: ["Instant"],
                manaCost: { X: 2, W: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "moveSpellFromStack",
                        target: { target: 0 },
                        destination: "hand",
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });

    it.each([
        [
            "a spell you don't control",
            "Return target spell you don't control to its owner's hand.",
        ],
        [
            "a spell-or-creature union",
            "Return target spell or creature to its owner's hand.",
        ],
        [
            "a spell sent to a library",
            "Put target spell on the top of its owner's library.",
        ],
        ["a sweep of spells", "Return all spells to their owners' hands."],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(instant("Probe", "{U}", text)).state).toBe(
            "unparsed"
        );
    });
});
