// "You may tap or untap target <permanent>" — the two-way tap (CR 701.26a,
// CR 701.26b), the direction picked on resolution (CR 608.2d): `optionChoice`
// over two `tapUntap` modes on ONE announced target (issue #8169).
//
//  1. GOLDENS — real Oracle cards compiled whole, one per argument class and
//     per site: trigger, spell, activated, quoted grant, ", then" chain.
//  2. ARGUMENT CLASSES whose only cards are held back by another line: read at
//     the sentence, the level the rule owns.
//  3. REFUSALS — the neighbours the rule must not read: an object named any
//     way but by an announced target, and the two-way verb without "you may".

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { sentenceRule } from "../grammar/shared/effectClause";
import { oracleCard, parseContext } from "./oracle.fixture";

const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

/** The lowering every accepted form shares, at one announced slot. */
function tapOrUntap(slot: number, prompt = "Tap or untap the target?") {
    const mode = (id: "tap" | "untap", label: string) => ({
        id,
        label,
        effects: [{ op: "tapUntap", action: id, target: { target: slot } }],
    });
    return {
        op: "optionChoice",
        prompt,
        modes: [mode("tap", "Tap"), mode("untap", "Untap")],
    };
}

function definitionOf(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(`${card.name} did not compile`);
    return sortKeys(outcome.definition);
}

describe("tap or untap clause — goldens (CR 701.26a, CR 608.2d)", () => {
    it("trigger, target creature — Sewer-veillance Cam, and no `optional` wrapper", () => {
        const oracleText =
            "Flash\nWhen this artifact enters or leaves the battlefield, you may tap or untap target creature.\n{3}{U}, Sacrifice this artifact: Draw two cards.";
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "25c83d45-581f-48ba-b6bb-feb66e8a65c7",
                    name: "Sewer-veillance Cam",
                    manaCost: "{U}",
                    typeLine: "Artifact",
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Sewer-veillance Cam",
                types: ["Artifact"],
                manaCost: { U: 1 },
                oracleText,
                staticAbilities: ["flash"],
                activatedAbilities: [
                    {
                        id: "sewer-veillance-cam-ability",
                        oracleText:
                            "{3}{U}, Sacrifice this artifact: Draw two cards.",
                        cost: { mana: { X: 3, U: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 2 },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "sewer-veillance-cam-trigger",
                        oracleText:
                            "When this artifact enters or leaves the battlefield, you may tap or untap target creature.",
                        head: { kind: "enters-or-leaves" },
                        targetRequirement: { type: "Creature", count: 1 },
                        effects: [tapOrUntap(0)],
                    },
                ],
            })
        );
    });

    it("trigger, target permanent — Pestermite", () => {
        const oracleText =
            "Flash\nFlying\nWhen this creature enters, you may tap or untap target permanent.";
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "83cf4235-eb4e-4c55-839a-f2740d41ed5e",
                    name: "Pestermite",
                    manaCost: "{2}{U}",
                    typeLine: "Creature — Faerie Rogue",
                    oracleText,
                    power: "2",
                    toughness: "1",
                })
            )
        ).toEqual(
            sortKeys({
                name: "Pestermite",
                types: ["Creature"],
                subtypes: ["Faerie", "Rogue"],
                manaCost: { X: 2, U: 1 },
                power: 2,
                toughness: 1,
                oracleText,
                staticAbilities: ["flash", "flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "pestermite-trigger",
                        oracleText:
                            "When this creature enters, you may tap or untap target permanent.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: PERMANENT_TYPES,
                            count: 1,
                        },
                        effects: [tapOrUntap(0)],
                    },
                ],
            })
        );
    });

    it("spell, target artifact, creature, or land — Twiddle", () => {
        const oracleText =
            "You may tap or untap target artifact, creature, or land.";
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "773ad2ef-5acc-49ea-8d85-056330e87039",
                    name: "Twiddle",
                    manaCost: "{U}",
                    typeLine: "Instant",
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Twiddle",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText,
                effects: [tapOrUntap(0)],
                targetRequirement: {
                    type: ["Artifact", "Creature", "Land"],
                    count: 1,
                },
            })
        );
    });

    it("activated, target artifact an opponent controls — Hyperion Blacksmith", () => {
        const oracleText =
            "{T}: You may tap or untap target artifact an opponent controls.";
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "bafad165-c2aa-45d1-8f99-05e752450dfd",
                    name: "Hyperion Blacksmith",
                    manaCost: "{1}{R}{R}",
                    typeLine: "Creature — Human Artificer",
                    oracleText,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Hyperion Blacksmith",
                types: ["Creature"],
                subtypes: ["Human", "Artificer"],
                manaCost: { X: 1, R: 2 },
                power: 2,
                toughness: 2,
                oracleText,
                activatedAbilities: [
                    {
                        id: "hyperion-blacksmith-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [tapOrUntap(0)],
                        targetRequirement: {
                            type: "Artifact",
                            count: 1,
                            controller: "opponent",
                        },
                    },
                ],
            })
        );
    });

    it("activated, another target permanent — Fatestitcher: not the source", () => {
        const { activatedAbilities } = definitionOf(
            oracleCard({
                oracleId: "55765934-07be-4f03-a2e8-8292c0b601ae",
                name: "Fatestitcher",
                manaCost: "{3}{U}",
                typeLine: "Creature — Zombie Wizard",
                oracleText:
                    "{T}: You may tap or untap another target permanent.",
                power: "1",
                toughness: "2",
            })
        ) as { activatedAbilities: unknown[] };
        expect(activatedAbilities).toEqual([
            sortKeys({
                id: "fatestitcher-ability",
                oracleText:
                    "{T}: You may tap or untap another target permanent.",
                cost: { tap: true },
                useStack: true,
                effects: [tapOrUntap(0)],
                targetRequirement: {
                    type: PERMANENT_TYPES,
                    count: 1,
                    excludeSource: true,
                },
            }),
        ]);
    });

    it('", then" chain — Hidden Strings: two picks, two slots, the second excluding the first (CR 115.3)', () => {
        const oracleText =
            "You may tap or untap target permanent, then you may tap or untap another target permanent.\nCipher (Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)";
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "a50737d7-dd2d-40da-817c-f913f76b5011",
                    name: "Hidden Strings",
                    manaCost: "{1}{U}",
                    typeLine: "Sorcery",
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Hidden Strings",
                types: ["Sorcery"],
                manaCost: { X: 1, U: 1 },
                oracleText,
                staticAbilities: ["cipher"],
                effects: [
                    tapOrUntap(0),
                    tapOrUntap(1, "Tap or untap the other target?"),
                ],
                targetRequirement: { type: PERMANENT_TYPES, count: 1 },
                additionalTargetRequirements: [
                    {
                        type: PERMANENT_TYPES,
                        count: 1,
                        excludePriorTargets: true,
                    },
                ],
            })
        );
    });

    it("quoted grant — Ghostly Touch: the trigger the Aura gives its host", () => {
        const oracleText =
            'Enchant creature\nEnchanted creature has "Whenever this creature attacks, you may tap or untap target permanent."';
        expect(
            definitionOf(
                oracleCard({
                    oracleId: "02d25219-888d-4032-9e9e-8c6f879a9084",
                    name: "Ghostly Touch",
                    manaCost: "{1}{U}",
                    typeLine: "Enchantment — Aura",
                    oracleText,
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Ghostly Touch",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                manaCost: { X: 1, U: 1 },
                oracleText,
                compiledStaticEffects: [
                    {
                        kind: "triggered-grant",
                        appliesTo: "host",
                        abilityId: "ghostly-touch-granted",
                    },
                ],
                compiledTriggeredGrantTemplates: [
                    {
                        id: "ghostly-touch-granted",
                        oracleText:
                            "Whenever this creature attacks, you may tap or untap target permanent.",
                        head: { kind: "attacks" },
                        targetRequirement: {
                            type: PERMANENT_TYPES,
                            count: 1,
                        },
                        effects: [tapOrUntap(0)],
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
});

describe("tap or untap clause — classes whose cards wait on another line", () => {
    it.each([
        // Inverted Iceberg: "Craft with artifact" holds the card back.
        [
            "target artifact or creature",
            { type: ["Artifact", "Creature"], count: 1 },
        ],
        // Stinging Lionfish: its trigger head holds the card back.
        [
            "target nonland permanent",
            { type: PERMANENT_TYPES, count: 1, excludeTypes: ["Land"] },
        ],
    ])("reads %s", (phrase, requirement) => {
        const read = sentenceRule.run(
            `You may tap or untap ${phrase}`,
            parseContext()
        );
        expect(read).toMatchObject({
            ok: true,
            value: {
                role: "effect",
                effect: {
                    frames: [
                        {
                            frame: "tapOrUntap",
                            subject: { kind: "target", requirement },
                        },
                    ],
                },
            },
        });
    });
});

describe("tap or untap clause — refusals (ADR 0105)", () => {
    it.each([
        [
            "Vedalken Anatomist — an anaphor, not an announced target",
            "{2}{U}, {T}: Put a -1/-1 counter on target creature. You may tap or untap that creature.",
        ],
        [
            "Sword of the Paruns — the equipped creature",
            "{3}: You may tap or untap equipped creature.",
        ],
        [
            "Urza's Contact Lenses — the source",
            "{1}: You may tap or untap this artifact.",
        ],
        [
            'Curse of Inertia — another player\'s "may", and "of their choice"',
            "When this creature enters, that attacking player may tap or untap target permanent of their choice.",
        ],
        [
            "a counted target — no card prints it",
            "When this creature enters, you may tap or untap up to one target creature.",
        ],
        [
            'no "you may" — the two-way verb alone',
            "When this creature enters, tap or untap target creature.",
        ],
    ])("%s", (_name, oracleText) => {
        expect(compileCard(oracleCard({ oracleText })).state).toBe("unparsed");
    });
});
