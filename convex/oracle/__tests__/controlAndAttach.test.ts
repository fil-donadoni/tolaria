// Control and attachment: "Gain control of target <permanent>" with and
// without CR 611.2b's "for as long as you control <this object>" (CR 613.1b),
// and an Aura's "Attach this Aura to target <permanent>" (CR 701.3a,
// issue #4530).
//
// Layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form.
//  2. REFUSALS — the neighbours the corpus prints that these rules do not
//     read, so fail-closed is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { sentenceRule } from "../grammar/shared/effectClause";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Partial<CardDefinition> & Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

const SOWER_OF_TEMPTATION = oracleCard({
    name: "Sower of Temptation",
    manaCost: "{2}{U}{U}",
    typeLine: "Creature — Faerie Wizard",
    oracleText:
        "Flying\nWhen this creature enters, gain control of target creature for as long as this creature remains on the battlefield.",
    power: "2",
    toughness: "2",
});

const RUBINIA_SOULSINGER = oracleCard({
    name: "Rubinia Soulsinger",
    manaCost: "{2}{G}{W}{U}",
    typeLine: "Legendary Creature — Faerie",
    oracleText:
        "You may choose not to untap Rubinia Soulsinger during your untap step.\n{T}: Gain control of target creature for as long as you control Rubinia Soulsinger and Rubinia Soulsinger remains tapped.",
    power: "2",
    toughness: "3",
});

const HORNED_HELM = oracleCard({
    name: "Horned Helm",
    manaCost: "{2}",
    typeLine: "Artifact — Equipment",
    oracleText:
        "Equipped creature gets +1/+1 and has trample.\n{G}{G}: Attach this Equipment to target creature you control.\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
    power: undefined,
    toughness: undefined,
});

describe("Gain control — golden fixtures (CR 613.1b, CR 611.2b)", () => {
    it("activated, indefinite: Empress Galina", () => {
        const text =
            "{U}{U}, {T}: Gain control of target legendary permanent. (This effect lasts indefinitely.)";
        expectDefinition(
            oracleCard({
                name: "Empress Galina",
                manaCost: "{3}{U}{U}",
                typeLine: "Legendary Creature — Merfolk Noble",
                oracleText: text,
                power: "1",
                toughness: "3",
            }),
            {
                name: "Empress Galina",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Merfolk", "Noble"],
                manaCost: { X: 3, U: 2 },
                power: 1,
                toughness: 3,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "empress-galina-ability",
                        oracleText:
                            "{U}{U}, {T}: Gain control of target legendary permanent.",
                        cost: { mana: { U: 2 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "gainControl",
                                target: { target: 0 },
                                controller: "controller",
                            },
                        ],
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                            supertypeFilter: ["Legendary"],
                        },
                    },
                ],
            }
        );
    });

    it("activated, for as long as you control this creature: Aladdin", () => {
        const text =
            "{1}{R}{R}, {T}: Gain control of target artifact for as long as you control this creature.";
        expectDefinition(
            oracleCard({
                name: "Aladdin",
                manaCost: "{2}{R}{R}",
                typeLine: "Creature — Human Rogue",
                oracleText: text,
                power: "1",
                toughness: "1",
            }),
            {
                name: "Aladdin",
                types: ["Creature"],
                subtypes: ["Human", "Rogue"],
                manaCost: { X: 2, R: 2 },
                power: 1,
                toughness: 1,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "aladdin-ability",
                        oracleText: text,
                        cost: { mana: { X: 1, R: 2 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "gainControl",
                                target: { target: 0 },
                                controller: "controller",
                                duration: "while-you-control-source",
                            },
                        ],
                        targetRequirement: { type: "Artifact", count: 1 },
                    },
                ],
            }
        );
    });

    it("triggered, for as long as you control this creature: Master Thief", () => {
        const text =
            "When this creature enters, gain control of target artifact for as long as you control this creature.";
        expectDefinition(
            oracleCard({
                name: "Master Thief",
                manaCost: "{2}{U}{U}",
                typeLine: "Creature — Human Rogue",
                oracleText: text,
                power: "2",
                toughness: "2",
            }),
            {
                name: "Master Thief",
                types: ["Creature"],
                subtypes: ["Human", "Rogue"],
                manaCost: { X: 2, U: 2 },
                power: 2,
                toughness: 2,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "master-thief-trigger",
                        oracleText: text,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: { type: "Artifact", count: 1 },
                        effects: [
                            {
                                op: "gainControl",
                                target: { target: 0 },
                                controller: "controller",
                                duration: "while-you-control-source",
                            },
                        ],
                    },
                ],
            }
        );
    });
});

describe("Attach this Aura — golden fixture (CR 701.3a)", () => {
    it("activated, an Aura with a bare Enchant line: Felidar Umbra", () => {
        const text =
            "Enchant creature\nEnchanted creature has lifelink.\n{1}{W}: Attach this Aura to target creature you control.\nUmbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)";
        expectDefinition(
            oracleCard({
                name: "Felidar Umbra",
                manaCost: "{1}{W}",
                typeLine: "Enchantment — Aura",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            }),
            {
                name: "Felidar Umbra",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                manaCost: { X: 1, W: 1 },
                oracleText: text,
                staticAbilities: ["umbra armor"],
                activatedAbilities: [
                    {
                        id: "felidar-umbra-ability",
                        oracleText:
                            "{1}{W}: Attach this Aura to target creature you control.",
                        cost: { mana: { X: 1, W: 1 } },
                        useStack: true,
                        effects: [{ op: "attach", target: { target: 0 } }],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "you",
                        },
                    },
                ],
                compiledStaticEffects: [
                    {
                        kind: "keyword-grant",
                        appliesTo: "host",
                        keyword: "lifelink",
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            }
        );
    });
});

describe("Control and attachment — refused neighbours", () => {
    it("a duration tied to the source staying on the battlefield is not 'while you control' (Sower of Temptation)", () => {
        expect(compileCard(SOWER_OF_TEMPTATION).state).toBe("unparsed");
    });

    it("a duration tied to the stolen creature's state is refused (Rootwater Matriarch)", () => {
        const card = oracleCard({
            name: "Rootwater Matriarch",
            manaCost: "{2}{U}{U}",
            typeLine: "Creature — Merfolk",
            oracleText:
                "{T}: Gain control of target creature for as long as that creature is enchanted.",
            power: "2",
            toughness: "3",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    it("'you control <this> and <this> remains tapped' is not the bare 'while you control' tail (Rubinia Soulsinger)", () => {
        const line =
            "{T}: Gain control of target creature for as long as you control {self} and {self} remains tapped.";
        expect(routeLine(line, parseContext(RUBINIA_SOULSINGER)).ok).toBe(
            false
        );
    });

    it("attaching another object to the source is not the attach Op's shape (Kazuul's Toll Collector)", () => {
        const card = oracleCard({
            name: "Kazuul's Toll Collector",
            manaCost: "{2}{R}",
            typeLine: "Creature — Ogre Warrior",
            oracleText:
                "{0}: Attach target Equipment you control to this creature. Activate only as a sorcery.",
            power: "3",
            toughness: "2",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    it("a targeted mover is not the source the attach Op moves (Aura Finesse)", () => {
        const card = oracleCard({
            name: "Aura Finesse",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Attach target Aura you control to target creature.\nDraw a card.",
            power: undefined,
            toughness: undefined,
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    it("an Equipment's attach line is not read until a golden can pin it (Horned Helm)", () => {
        const line =
            "{G}{G}: Attach this Equipment to target creature you control.";
        expect(routeLine(line, parseContext(HORNED_HELM)).ok).toBe(false);
    });

    // The sentence alone, so the refusal is this rule's and not a later
    // sentence's: each is the opening sentence of a real corpus card.
    it.each([
        [
            "an 'until end of turn' steal (Act of Treason)",
            "Gain control of target creature until end of turn",
        ],
        ["a spell target (Aethersnatch)", "Gain control of target spell"],
        [
            "a variable-count target group (Mass Manipulation)",
            "Gain control of X target creatures and/or planeswalkers",
        ],
        [
            "an 'up to one' target group (Bilbo's Burglaring's clause, its per-opponent frame removed)",
            "Gain control of up to one target artifact",
        ],
    ])("gain control refuses %s", (_label, span) => {
        expect(sentenceRule.run(span, parseContext()).ok).toBe(false);
    });

    // CR 701.3a — an Aura attaches only to what its Enchant line names. No
    // printed card asks for anything else, so this is Felidar Umbra with its
    // target retyped: the one place the type-subset check is reachable.
    it("an Aura's attach to a permanent its Enchant line excludes is refused (Felidar Umbra, target retyped to land)", () => {
        const card = oracleCard({
            name: "Felidar Umbra",
            manaCost: "{1}{W}",
            typeLine: "Enchantment — Aura",
            oracleText:
                "Enchant creature\nEnchanted creature has lifelink.\n{1}{W}: Attach this Aura to target land you control.",
            power: undefined,
            toughness: undefined,
        });
        expect(
            routeLine(
                "{1}{W}: Attach this Aura to target land you control.",
                parseContext(card)
            ).ok
        ).toBe(false);
    });
});
