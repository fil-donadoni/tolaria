// Triggered ability granted to a set — '<plural descriptor> have "<triggered
// ability>"' (CR 113.1a, CR 613.1f), with the trigger's own "This ability
// triggers only twice each turn" limit (CR 603.2) and the "becomes the target
// of a spell or ability" head (CR 603.2).
//
//  1. GOLDEN — a real corpus card compiled whole per accepted form: Nadu (the
//     limit + the target head + revealTopAndRoute) and Energy Flux (a grant
//     with no limit, whose prompt names each recipient).
//  2. REFUSALS — the neighbours the corpus prints that this rule does not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const NADU =
    'Flying\nCreatures you control have "Whenever this creature becomes the target of a spell or ability, reveal the top card of your library. If it\'s a land card, put it onto the battlefield. Otherwise, put it into your hand. This ability triggers only twice each turn."';
const FLUX =
    'All artifacts have "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}."';

function creature(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{1}{G}{U}",
            typeLine: "Creature — Bird",
            power: "3",
            toughness: "4",
            oracleText,
        })
    );
}

describe("Triggered grant to a set — golden fixtures", () => {
    it("became-target head, twice-per-turn limit, reveal and route: Nadu, Winged Wisdom", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Nadu, Winged Wisdom",
                manaCost: "{1}{G}{U}",
                typeLine: "Legendary Creature — Bird Wizard",
                power: "3",
                toughness: "4",
                oracleText: NADU,
            })
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Nadu, Winged Wisdom",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Bird", "Wizard"],
                manaCost: { X: 1, U: 1, G: 1 },
                power: 3,
                toughness: 4,
                oracleText: NADU,
                staticAbilities: ["flying"],
                compiledStaticEffects: [
                    {
                        kind: "triggered-grant",
                        filter: {
                            types: ["Creature"],
                            controllerRelation: "you",
                        },
                        abilityId: "nadu-winged-wisdom-granted",
                    },
                ],
                compiledTriggeredGrantTemplates: [
                    {
                        id: "nadu-winged-wisdom-granted",
                        oracleText:
                            "Whenever this creature becomes the target of a spell or ability, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand. This ability triggers only twice each turn.",
                        head: { kind: "became-target" },
                        maxTriggersPerTurn: 2,
                        effects: [
                            {
                                op: "revealTopAndRoute",
                                player: "controller",
                                routes: [
                                    {
                                        filter: { type: "Land" },
                                        to: "battlefield",
                                    },
                                ],
                                fallback: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("grant with no limit, prompt names the recipient: Energy Flux", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Energy Flux",
                manaCost: "{2}{U}",
                typeLine: "Enchantment",
                power: undefined,
                toughness: undefined,
                oracleText: FLUX,
            })
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Energy Flux",
                types: ["Enchantment"],
                manaCost: { X: 2, U: 1 },
                oracleText: FLUX,
                compiledStaticEffects: [
                    {
                        kind: "triggered-grant",
                        filter: { types: ["Artifact"] },
                        abilityId: "energy-flux-granted",
                    },
                ],
                compiledTriggeredGrantTemplates: [
                    {
                        id: "energy-flux-granted",
                        oracleText:
                            "At the beginning of your upkeep, sacrifice this artifact unless you pay {2}.",
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "your",
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: { X: 2 },
                                prompt: "Pay the cost, or sacrifice this artifact?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { not: { binding: "$may1" } },
                                then: [
                                    {
                                        op: "sacrifice",
                                        target: { ref: "$source" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("Triggered grant to a set — refusals", () => {
    const REVEAL =
        "reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put it into your hand.";

    it("a limit behind a head whose factory cannot count it", () => {
        expect(
            creature(
                `Whenever this creature attacks, ${REVEAL} This ability triggers only twice each turn.`
            ).state
        ).toBe("unparsed");
    });

    it("a limit count the corpus does not print", () => {
        expect(
            creature(
                `Whenever this creature becomes the target of a spell or ability, ${REVEAL} This ability triggers only three times each turn.`
            ).state
        ).toBe("unparsed");
    });

    it("a head naming only a spell", () => {
        expect(
            creature(
                `Whenever this creature becomes the target of a spell, ${REVEAL}`
            ).state
        ).toBe("unparsed");
    });

    it("an activated ability granted to a set", () => {
        expect(
            creature('Creatures you control have "{T}: Draw a card."').state
        ).toBe("unparsed");
    });

    it("the granting card's own noun inside the quote", () => {
        expect(
            creature(
                'Creatures you control have "At the beginning of your upkeep, sacrifice this enchantment."'
            ).state
        ).toBe("unparsed");
    });

    it("a set naming no single card type", () => {
        expect(
            creature(
                'Permanents you control have "Whenever this permanent becomes the target of a spell or ability, draw a card."'
            ).state
        ).toBe("unparsed");
    });
});
