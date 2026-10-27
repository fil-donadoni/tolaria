// "Add X mana of any one color, where X is the number of <permanents> target
// opponent controls" — X mana of ONE colour picked as the effect resolves
// (CR 106.1a, CR 107.3), counted over a targeted opponent's board (CR 115.1).
//
//  1. GOLDEN — Carpet of Flowers, its real Oracle row, compiled whole.
//  2. REFUSALS — neighbours the rule must not read: an unbound X, "any color"
//     (each mana picked separately), a targeted PLAYER rather than opponent,
//     a counted noun carrying its own controller clause, and a per-player
//     damage count that would override the targeted controller.

import { describe, expect, it } from "vitest";
import { colorChoiceModes } from "../../cards/abilities/chooseColor";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const CARPET_TEXT =
    "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.";

function enchantment(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{G}",
        typeLine: "Enchantment",
        oracleText,
    });
}

const refused = (oracleText: string) =>
    compileCard(enchantment("Quota Garden", oracleText)).state === "unparsed";

describe("add X mana of any one color (CR 106.1a, CR 107.3)", () => {
    it("Carpet of Flowers compiles whole: a targeted opponent's Islands, one chosen colour", () => {
        const outcome = compileCard(
            enchantment("Carpet of Flowers", CARPET_TEXT)
        );
        if (outcome.state === "unparsed")
            throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Carpet of Flowers",
                types: ["Enchantment"],
                manaCost: { G: 1 },
                oracleText: CARPET_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "carpet-of-flowers-trigger",
                        oracleText: CARPET_TEXT,
                        head: {
                            kind: "phase",
                            phase: "PRECOMBAT_MAIN",
                            scope: "your",
                            phases: ["PRECOMBAT_MAIN", "POSTCOMBAT_MAIN"],
                        },
                        maxTriggersPerTurn: 1,
                        targetRequirement: {
                            type: "player",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Add X mana of any one color, where X is the number of Islands target opponent controls?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "optionChoice",
                                        prompt: "Carpet of Flowers: add mana of which color?",
                                        modes: colorChoiceModes((color) => [
                                            {
                                                op: "addMana",
                                                mana: {
                                                    [color]: {
                                                        count: {
                                                            zone: "battlefield",
                                                            controller: {
                                                                target: 0,
                                                            },
                                                            filter: {
                                                                subtype:
                                                                    "Island",
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        ]),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("refuses an X no 'where X is' tail defines", () => {
        expect(
            refused(
                "At the beginning of your upkeep, add X mana of any one color."
            )
        ).toBe(true);
    });

    it("refuses 'any color' (each mana picked separately)", () => {
        expect(refused(CARPET_TEXT.replace("any one color", "any color"))).toBe(
            true
        );
    });

    it("refuses a targeted player in place of a targeted opponent", () => {
        expect(
            refused(CARPET_TEXT.replace("target opponent", "target player"))
        ).toBe(true);
    });

    it("refuses a counted noun with a controller clause of its own", () => {
        expect(
            refused(
                CARPET_TEXT.replace(
                    "Islands target opponent controls",
                    "Islands you control target opponent controls"
                )
            )
        ).toBe(true);
    });

    it("refuses a printed amount in place of X", () => {
        expect(
            refused(
                "At the beginning of your upkeep, add two mana of any one color."
            )
        ).toBe(true);
    });
});
