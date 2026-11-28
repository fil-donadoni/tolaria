// "Spend this mana only to cast a creature spell." after a mana production
// (CR 106.6): the mana-ability rider lowered to
// `manaRestriction: "creature-spell"`.
//
//  1. GOLDEN fixtures — a real corpus row per accepted form, compiled to the
//     WHOLE Compiled Definition: a fixed production (Rockface Village, beside
//     its plain {C} tap and its pump ability) and "one mana of any color"
//     (Ancient Ziggurat), the Delighted Halfling shape of `manaChoices` +
//     `manaRestriction`.
//  2. REFUSALS — neighbours naming a DIFFERENT restriction, a production the
//     rider is not read after, and the two cluster members out of reach
//     (Three Tree City, Helga, Skittish Seer) stay `unparsed` (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";

import { oracleCard } from "./oracle.fixture";

function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(
            `${card.name} did not reach ready: ${outcome.state} — ${JSON.stringify(
                outcome.state === "unparsed" ? outcome.gaps : outcome.reasons
            )}`
        );
    return outcome.definition;
}

function land(name: string, oracleText: string, oracleId?: string): OracleCard {
    return oracleCard({
        ...(oracleId === undefined ? {} : { oracleId }),
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const RIDER = "Spend this mana only to cast a creature spell.";

describe("golden — the creature-spell rider lowers to manaRestriction", () => {
    it("Rockface Village (BLB) — a fixed production", () => {
        const oracleText = `{T}: Add {C}.\n{T}: Add {R}. ${RIDER}\n{R}, {T}: Target Lizard, Mouse, Otter, or Raccoon you control gets +1/+0 and gains haste until end of turn. Activate only as a sorcery.`;
        const compiled = compiledOf(
            land(
                "Rockface Village",
                oracleText,
                "7e103748-3f76-42ce-a063-d0256b2dce2b"
            )
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Rockface Village",
                types: ["Land"],
                oracleText,
                activatedAbilities: [
                    {
                        id: "rockface-village-mana",
                        oracleText: "{T}: Add {C}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { C: 1 },
                    },
                    {
                        id: "rockface-village-mana-2",
                        oracleText: `{T}: Add {R}. ${RIDER}`,
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { R: 1 },
                        manaRestriction: "creature-spell",
                    },
                    {
                        id: "rockface-village-ability-3",
                        oracleText:
                            "{R}, {T}: Target Lizard, Mouse, Otter, or Raccoon you control gets +1/+0 and gains haste until end of turn. Activate only as a sorcery.",
                        cost: { mana: { R: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { target: 0 },
                                power: 1,
                                toughness: 0,
                                duration: { phase: "end-of-turn" },
                            },
                            {
                                op: "grantAbility",
                                target: { target: 0 },
                                ability: "haste",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            subtypeFilter: [
                                "Lizard",
                                "Mouse",
                                "Otter",
                                "Raccoon",
                            ],
                            controller: "you",
                        },
                        sorcerySpeedOnly: true,
                    },
                ],
            })
        );
    });

    it("Ancient Ziggurat — one mana of any color", () => {
        const oracleText = `{T}: Add one mana of any color. ${RIDER}`;
        const compiled = compiledOf(
            land(
                "Ancient Ziggurat",
                oracleText,
                "0baabe39-72ae-47bd-a095-cbf7eb8a6361"
            )
        );
        expect(sortKeys(compiled)).toEqual(
            sortKeys({
                name: "Ancient Ziggurat",
                types: ["Land"],
                oracleText,
                activatedAbilities: [
                    {
                        id: "ancient-ziggurat-mana",
                        oracleText,
                        cost: { tap: true },
                        useStack: false,
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                        ],
                        manaRestriction: "creature-spell",
                    },
                ],
            })
        );
    });
});

describe("refusals — only the plain creature-spell permission is read", () => {
    it.each([
        [
            "of the chosen type (a source-keyed restriction)",
            land(
                "Test Rider",
                "{T}: Add {G}. Spend this mana only to cast a creature spell of the chosen type."
            ),
        ],
        [
            "a can't-be-countered rider beside it",
            land(
                "Test Rider",
                "{T}: Add {G}. Spend this mana only to cast a creature spell, and that spell can't be countered."
            ),
        ],
        [
            "the plural with a mana-value clause",
            land(
                "Test Rider",
                "{T}: Add {G}. Spend this mana only to cast creature spells with mana value 4 or greater."
            ),
        ],
        [
            "after a board-counted production",
            oracleCard({
                name: "Test Rider",
                typeLine: "Creature — Elf Druid",
                oracleText:
                    "{T}: Add {G} for each Elf you control. Spend this mana only to cast a creature spell.",
            }),
        ],
        [
            "Three Tree City — a colour choice counted by the source's chosen type",
            oracleCard({
                name: "Three Tree City",
                manaCost: "",
                typeLine: "Legendary Land",
                oracleText:
                    "As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.",
                power: undefined,
                toughness: undefined,
            }),
        ],
        [
            "Helga, Skittish Seer — X of one colour by power, a compound restriction",
            oracleCard({
                name: "Helga, Skittish Seer",
                manaCost: "{G}{W}{U}",
                typeLine: "Legendary Creature — Frog Druid",
                oracleText:
                    "Whenever you cast a creature spell with mana value 4 or greater, you draw a card, gain 1 life, and put a +1/+1 counter on Helga.\n{T}: Add X mana of any one color, where X is Helga's power. Spend this mana only to cast creature spells with mana value 4 or greater or creature spells with {X} in their mana costs.",
                power: "1",
                toughness: "3",
            }),
        ],
    ])("%s stays unparsed", (_label, card) => {
        expect(compileCard(card).state).toBe("unparsed");
    });
});
