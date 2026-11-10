// "Add X mana of any one color, where X is the number of <permanents> target
// opponent controls" — X mana of ONE colour picked as the effect resolves
// (CR 106.1a, CR 107.3), counted over a targeted opponent's board (CR 115.1).
//
//  1. GOLDEN — Carpet of Flowers, its real Oracle row, compiled whole.
//  2. REFUSALS — neighbours the rule must not read: an unbound X, "any color"
//     (each mana picked separately), a targeted PLAYER rather than opponent,
//     a counted noun carrying its own controller clause, and a per-player
//     damage count that would override the targeted controller.
//  3. "Add one mana of any color" — the single-mana case of the same read
//     (CR 106.1a): Quirion Sentinel's golden, its hand-written twin compiled
//     back, and the neighbours that count or restrict the offered set.

import { describe, expect, it } from "vitest";
import { colorChoiceModes } from "../../cards/abilities/chooseColor";
import { quirionSentinel } from "../../cards/sets/inv/green.cards";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { roundTripCard } from "../gold";
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

    it("refuses the targeted-opponent count at a site with no fixture (life, draw)", () => {
        for (const oracleText of [
            "When this enchantment enters, target opponent loses life equal to the number of Islands target opponent controls.",
            "When this enchantment enters, draw X cards, where X is the number of Islands target opponent controls.",
        ]) {
            const outcome = compileCard(
                enchantment("Quota Garden", oracleText)
            );
            if (outcome.state !== "unparsed")
                throw new Error(`compiled: ${oracleText}`);
            expect(outcome.gaps.map((g) => g.reason)).toEqual([
                '"target opponent controls" in a count has no fixture at this site',
            ]);
        }
    });

    it("refuses a printed amount in place of X", () => {
        expect(
            refused(
                "At the beginning of your upkeep, add two mana of any one color."
            )
        ).toBe(true);
    });
});

const SENTINEL_TEXT = "When this creature enters, add one mana of any color.";

describe("add one mana of any color (CR 106.1a)", () => {
    const creature = (name: string, oracleText: string) =>
        oracleCard({
            name,
            manaCost: "{1}{G}",
            typeLine: "Creature — Elf Druid",
            oracleText,
            power: "2",
            toughness: "1",
        });

    it("Quirion Sentinel compiles whole: one mana of a colour picked on resolution", () => {
        const outcome = compileCard(
            creature("Quirion Sentinel", SENTINEL_TEXT)
        );
        if (outcome.state === "unparsed")
            throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Quirion Sentinel",
                types: ["Creature"],
                subtypes: ["Elf", "Druid"],
                manaCost: { X: 1, G: 1 },
                power: 2,
                toughness: 1,
                oracleText: SENTINEL_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "quirion-sentinel-trigger",
                        oracleText: SENTINEL_TEXT,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "optionChoice",
                                prompt: "Quirion Sentinel: add mana of which color?",
                                modes: colorChoiceModes((color) => [
                                    { op: "addMana", mana: { [color]: 1 } },
                                ]),
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("the hand-written Quirion Sentinel compiles back from its own text", () => {
        expect(roundTripCard(quirionSentinel()).verdict.ok).toBe(true);
    });

    it.each([
        [
            "a count of two mana",
            "When this creature enters, add two mana of any color.",
        ],
        [
            "a board-derived restriction of the colours",
            "When this creature enters, add one mana of any color that a land you control could produce.",
        ],
        [
            "a combination of colours",
            "When this creature enters, add two mana in any combination of colors.",
        ],
        [
            "another player as the recipient",
            "When this creature enters, that player adds one mana of any color.",
        ],
    ])("refuses %s", (_label, oracleText) => {
        expect(compileCard(creature("Quota Elf", oracleText)).state).toBe(
            "unparsed"
        );
    });
});
