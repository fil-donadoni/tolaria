// Characteristic-setting statics (CR 613, issue #4565): the frames that SET a
// characteristic where an anthem or keyword grant only adds to it.
//
//  1. GOLDEN — one real corpus card per accepted form, the whole Compiled
//     Definition compared (`compileCard(oracleCard(...))` toEqual).
//  2. REFUSALS — the neighbours each frame must not read, fail-closed.
//  3. EXPANSION — each descriptor rebuilds into the engine effect the
//     hand-written card declares.

import { describe, expect, it } from "vitest";
import { expandCompiledStatics } from "../../cards/compiledStatics";
import { compileCard } from "../compile";
import { CREATURE_SUBTYPES } from "../grammar/shared/subtypes";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome;
}

const HUMILITY = oracleCard({
    name: "Humility",
    manaCost: "{2}{W}{W}",
    typeLine: "Enchantment",
    power: undefined,
    toughness: undefined,
    oracleText:
        "All creatures lose all abilities and have base power and toughness 1/1.",
});

const ENGINEERED_PLAGUE = oracleCard({
    name: "Engineered Plague",
    manaCost: "{2}{B}",
    typeLine: "Enchantment",
    power: undefined,
    toughness: undefined,
    oracleText:
        "As this enchantment enters, choose a creature type.\nAll creatures of the chosen type get -1/-1.",
});

const OPALESCENCE = oracleCard({
    name: "Opalescence",
    manaCost: "{2}{W}{W}",
    typeLine: "Enchantment",
    power: undefined,
    toughness: undefined,
    oracleText:
        "Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.",
});

const TERRAVORE = oracleCard({
    name: "Terravore",
    manaCost: "{1}{G}{G}",
    typeLine: "Creature — Lhurgoyf",
    power: "*",
    toughness: "*",
    oracleText:
        "Trample\nTerravore's power and toughness are each equal to the number of land cards in all graveyards.",
});

const SKYSHROUD_ELITE = oracleCard({
    name: "Skyshroud Elite",
    manaCost: "{G}",
    typeLine: "Creature — Elf Scout",
    power: "1",
    toughness: "1",
    oracleText:
        "This creature gets +1/+2 as long as an opponent controls a nonbasic land.",
});

describe("characteristic-setting statics — goldens (CR 613)", () => {
    it("Humility: ability loss (layer 6) + base P/T set (7b) over every creature", () => {
        expect(compiled(HUMILITY).definition).toEqual({
            name: "Humility",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 2 },
            oracleText:
                "All creatures lose all abilities and have base power and toughness 1/1.",
            compiledStaticEffects: [
                { kind: "ability-loss", filter: { types: ["Creature"] } },
                {
                    kind: "pt-set",
                    filter: { types: ["Creature"] },
                    power: 1,
                    toughness: 1,
                },
            ],
        });
    });

    it("Engineered Plague: -1/-1 over the chosen creature type (CR 607.2d)", () => {
        const { definition } = compiled(ENGINEERED_PLAGUE);
        expect(definition.compiledStaticEffects).toEqual([
            {
                kind: "pt-buff",
                appliesTo: "chosen-subtype",
                power: -1,
                toughness: -1,
            },
        ]);
        expect(definition.entersWith).toEqual({
            asEnters: [
                { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
            ],
        });
    });

    it("Opalescence: type-add Creature + P/T equal to the affected permanent's mana value", () => {
        const filter = {
            types: ["Enchantment"],
            excludeSubtypes: ["Aura"],
            excludeSource: true,
        };
        expect(compiled(OPALESCENCE).definition).toEqual({
            name: "Opalescence",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 2 },
            oracleText:
                "Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.",
            compiledStaticEffects: [
                { kind: "type-add", filter, types: ["Creature"] },
                { kind: "pt-cda", filter, count: { kind: "mana-value" } },
            ],
        });
    });

    it("Terravore: a star P/T is base 0 plus the graveyard-count definition (CR 604.3)", () => {
        expect(compiled(TERRAVORE).definition).toEqual({
            name: "Terravore",
            types: ["Creature"],
            subtypes: ["Lhurgoyf"],
            manaCost: { X: 1, G: 2 },
            power: 0,
            toughness: 0,
            oracleText:
                "Trample\nTerravore's power and toughness are each equal to the number of land cards in all graveyards.",
            staticAbilities: ["trample"],
            compiledStaticEffects: [
                {
                    kind: "pt-cda",
                    appliesTo: "self",
                    count: { kind: "graveyard-cards", types: ["Land"] },
                },
            ],
        });
    });

    it("Skyshroud Elite: +1/+2 while an opponent controls a nonbasic land (CR 611.3a)", () => {
        expect(compiled(SKYSHROUD_ELITE).definition).toEqual({
            name: "Skyshroud Elite",
            types: ["Creature"],
            subtypes: ["Elf", "Scout"],
            manaCost: { G: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "This creature gets +1/+2 as long as an opponent controls a nonbasic land.",
            compiledStaticEffects: [
                {
                    kind: "pt-buff",
                    appliesTo: "self",
                    power: 1,
                    toughness: 2,
                    condition: {
                        kind: "opponent-controls",
                        filter: {
                            types: ["Land"],
                            excludeSupertypes: ["Basic"],
                        },
                        atLeast: 1,
                    },
                },
            ],
        });
    });
});

describe("characteristic-setting statics — refusals (fail-closed)", () => {
    function unparsed(overrides: Partial<OracleCard>): boolean {
        return compileCard(oracleCard(overrides)).state === "unparsed";
    }

    it("REFUSES ability loss without the base P/T clause, and a non-plural set", () => {
        expect(
            unparsed({
                typeLine: "Enchantment",
                oracleText: "All creatures lose all abilities.",
            })
        ).toBe(true);
        expect(
            unparsed({
                typeLine: "Enchantment",
                oracleText:
                    "Target creature loses all abilities and has base power and toughness 1/1.",
            })
        ).toBe(true);
    });

    it('REFUSES "the chosen type" with no as-enters creature-type choice on the card', () => {
        expect(
            unparsed({
                typeLine: "Enchantment",
                oracleText: "All creatures of the chosen type get -1/-1.",
            })
        ).toBe(true);
    });

    it("REFUSES a mana-value P/T line that names a different type or drops the source exclusion's subject", () => {
        expect(
            unparsed({
                typeLine: "Enchantment",
                oracleText:
                    "Each other non-Aura enchantment is a banana in addition to its other types and has base power and base toughness each equal to its mana value.",
            })
        ).toBe(true);
        expect(
            unparsed({
                typeLine: "Enchantment",
                oracleText:
                    "Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness 2/2.",
            })
        ).toBe(true);
    });

    it("REFUSES a star P/T with no defining ability on the card", () => {
        expect(
            unparsed({
                name: "Test Star",
                typeLine: "Creature — Lhurgoyf",
                power: "*",
                toughness: "*",
                oracleText: "Trample",
            })
        ).toBe(true);
    });

    it("REFUSES a graveyard count of something that is not a card type, and another card's name", () => {
        expect(
            unparsed({
                name: "Test Star",
                typeLine: "Creature — Lhurgoyf",
                power: "*",
                toughness: "*",
                oracleText:
                    "Test Star's power and toughness are each equal to the number of banana cards in all graveyards.",
            })
        ).toBe(true);
        expect(
            unparsed({
                name: "Test Star",
                typeLine: "Creature — Lhurgoyf",
                power: "*",
                toughness: "*",
                oracleText:
                    "Terravore's power and toughness are each equal to the number of land cards in all graveyards.",
            })
        ).toBe(true);
    });

    it("REFUSES Sutured Ghoul's exiled-cards total — no engine surface reads it", () => {
        expect(
            unparsed({
                name: "Sutured Ghoul",
                manaCost: "{4}{B}{B}{B}",
                typeLine: "Creature — Zombie",
                power: "*",
                toughness: "*",
                oracleText:
                    "Sutured Ghoul's power is equal to the total power of the exiled cards and its toughness is equal to their total toughness.",
            })
        ).toBe(true);
    });

    it('REFUSES an "as long as" tail naming another player clause', () => {
        expect(
            unparsed({
                typeLine: "Creature — Elf Scout",
                oracleText:
                    "This creature gets +1/+2 as long as an opponent controls a creature with a bogus clause.",
            })
        ).toBe(true);
    });
});

describe("characteristic-setting statics — expansion", () => {
    it("rebuilds each descriptor into the engine effect kind it names", () => {
        const kinds = (card: OracleCard) =>
            (
                expandCompiledStatics(compiled(card).definition as never)
                    .staticEffects ?? []
            ).map((effect) => effect.kind);
        expect(kinds(HUMILITY)).toEqual(["ability-loss", "pt-set"]);
        expect(kinds(OPALESCENCE)).toEqual(["type-add", "pt-cda"]);
        expect(kinds(TERRAVORE)).toEqual(["pt-cda"]);
        expect(kinds(SKYSHROUD_ELITE)).toEqual(["pt-buff"]);
        expect(kinds(ENGINEERED_PLAGUE)).toEqual(["pt-buff"]);
    });
});
