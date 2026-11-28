// Colour filters on a target and on a sweep: "target white or black creature"
// (CR 105.1 + CR 105.2, `TargetRequirement.colorFilterAny`) and "all nonwhite
// creatures" (CR 105.2, `EffectCardFilter.excludeColor`).
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition, one per slot the colour-OR target reaches
//     (activated, spell, triggered from a graveyard) and one for the sweep.
//  2. REFUSALS — the neighbours the rules must NOT read: stacked colour
//     adjectives (an AND no target field means), a colour OR under a count
//     head nobody prints it with, and a colour OR on a sweep.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("colour OR target filter — golden fixtures (CR 105.1, CR 105.2)", () => {
    it("activated: Escape Routes — target white or black creature you control", () => {
        const card = oracleCard({
            oracleId: "65260087-48b5-4968-8584-7cc561bb312c",
            name: "Escape Routes",
            manaCost: "{2}{U}",
            typeLine: "Enchantment",
            oracleText:
                "{2}{U}: Return target white or black creature you control to its owner's hand.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Escape Routes",
                types: ["Enchantment"],
                manaCost: { X: 2, U: 1 },
                oracleText:
                    "{2}{U}: Return target white or black creature you control to its owner's hand.",
                activatedAbilities: [
                    {
                        id: "escape-routes-ability",
                        oracleText:
                            "{2}{U}: Return target white or black creature you control to its owner's hand.",
                        cost: { mana: { X: 2, U: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "hand",
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            colorFilterAny: ["W", "B"],
                            controller: "you",
                        },
                    },
                ],
            })
        );
    });

    it("spell: Wallop — target blue or black creature with flying", () => {
        const card = sorcery(
            "Wallop",
            "{1}{G}",
            "Destroy target blue or black creature with flying."
        );
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Wallop",
                types: ["Sorcery"],
                manaCost: { X: 1, G: 1 },
                oracleText:
                    "Destroy target blue or black creature with flying.",
                effects: [{ op: "destroy", target: { target: 0 } }],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    colorFilterAny: ["U", "B"],
                    requireAbility: "flying",
                },
            })
        );
    });

    it("triggered, from a graveyard: Crypt Angel — target blue or red creature card", () => {
        const text =
            "Flying, protection from white\nWhen this creature enters, return target blue or red creature card from your graveyard to your hand.";
        const card = oracleCard({
            oracleId: "665f3e52-c536-481b-8b29-fe68f08d1fdf",
            name: "Crypt Angel",
            manaCost: "{4}{B}",
            typeLine: "Creature — Angel",
            oracleText: text,
            power: "3",
            toughness: "3",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Crypt Angel",
                types: ["Creature"],
                subtypes: ["Angel"],
                manaCost: { X: 4, B: 1 },
                power: 3,
                toughness: 3,
                oracleText: text,
                staticAbilities: ["flying", "protection from white"],
                compiledTriggeredAbilities: [
                    {
                        id: "crypt-angel-trigger",
                        oracleText:
                            "When this creature enters, return target blue or red creature card from your graveyard to your hand.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            colorFilterAny: ["U", "R"],
                            zone: "graveyard",
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("non<colour> sweep — golden fixture (CR 105.2)", () => {
    it("Mass Calcify — destroy all nonwhite creatures", () => {
        const card = sorcery(
            "Mass Calcify",
            "{5}{W}{W}",
            "Destroy all nonwhite creatures."
        );
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Mass Calcify",
                types: ["Sorcery"],
                manaCost: { X: 5, W: 2 },
                oracleText: "Destroy all nonwhite creatures.",
                effects: [
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            filter: { type: "Creature", excludeColor: "W" },
                        },
                        effects: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            })
        );
    });
});

describe("colour filters — refused neighbours stay unparsed", () => {
    it.each([
        [
            "stacked colour adjectives (an AND, no printed 'or')",
            "Destroy target white black creature.",
        ],
        [
            "a colour OR under an 'up to one' head",
            "Destroy up to one target white or black creature.",
        ],
        ["a colour OR on a sweep", "Destroy all white or black creatures."],
    ])("%s", (_label, text) => {
        expect(compileCard(sorcery("Neighbour", "{2}{B}", text)).state).toBe(
            "unparsed"
        );
    });
});
