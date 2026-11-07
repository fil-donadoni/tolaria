// "Gain control of target spell. You may choose new targets for it." (CR 112.2,
// CR 115.7d) and the plural pitch "exile two blue cards from your hand" (CR
// 118.9), issue #8687.
//
// Two layers:
//
//  1. GOLDEN forms — real corpus cards compiled whole must produce exactly the
//     Compiled Definition below.
//  2. REFUSALS — the neighbours these rules must NOT read: another narrowed
//     stack phrase behind the same verb, the "new targets" sentence with no
//     announced spell or with its own subject, and a plural pitch that names no
//     real count or colour.

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

const EFFECTS = [
    {
        op: "gainControlOfSpell",
        target: { target: 0 },
        controller: "controller",
    },
    { op: "retarget", target: { target: 0 }, chooseNew: true },
];

describe("gain control of target spell (CR 112.2, CR 115.7d)", () => {
    it("compiles Commandeer whole, pitch cost included", () => {
        const text =
            "You may exile two blue cards from your hand rather than pay this spell's mana cost.\nGain control of target noncreature spell. You may choose new targets for it. (If that spell is an artifact, enchantment, or planeswalker, the permanent enters under your control.)";
        const outcome = compileCard(instant("Commandeer", "{5}{U}{U}", text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Commandeer",
                types: ["Instant"],
                manaCost: { X: 5, U: 2 },
                oracleText: text,
                effects: EFFECTS,
                targetRequirement: {
                    type: "spell",
                    count: 1,
                    spellExcludeTypeFilter: "Creature",
                },
                alternativeCosts: [
                    {
                        id: "pitch-exile-two-blue",
                        description: "Exile two blue cards from your hand",
                        hand: {
                            action: "exile",
                            requirements: [
                                { filter: { color: "U" }, count: 2 },
                            ],
                        },
                    },
                ],
            })
        );
    });

    it("compiles Aethersnatch whole", () => {
        const text =
            "Gain control of target spell. You may choose new targets for it. (If that spell becomes a permanent, it enters under your control.)";
        const outcome = compileCard(instant("Aethersnatch", "{4}{U}{U}", text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Aethersnatch",
                types: ["Instant"],
                manaCost: { X: 4, U: 2 },
                oracleText: text,
                effects: EFFECTS,
                targetRequirement: { type: "spell", count: 1 },
            })
        );
    });

    it.each([
        [
            "another narrowed stack phrase",
            "Gain control of target creature spell.",
        ],
        [
            "a stack phrase with an ability in it",
            "Gain control of target spell or ability.",
        ],
        [
            "new targets with no antecedent",
            "You may choose new targets for it.",
        ],
        [
            "new targets behind a permanent",
            "Destroy target creature. You may choose new targets for it.",
        ],
        [
            "new targets with a subject of its own",
            "You may choose new targets for target spell.",
        ],
        [
            "a plural pitch with no real count",
            "You may exile one blue cards from your hand rather than pay this spell's mana cost.\nDraw a card.",
        ],
        [
            "a plural pitch with no real colour",
            "You may exile two wobbly cards from your hand rather than pay this spell's mana cost.\nDraw a card.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(instant("Probe", "{U}", text)).state).toBe(
            "unparsed"
        );
    });
});
