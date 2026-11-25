// Combat-role trigger heads — "becomes blocked", "attacks or blocks", "attacks
// alone", "deals combat damage to a creature", "at the beginning of combat on
// each opponent's turn" (issue #4581).
//
//  1. GOLDENS — every accepted form on a real corpus card, compiled whole and
//     compared with `sortKeys` equality. Voracious Cobra is also a
//     `GOLDEN_FIXTURES` row: the canned smoke scenario does not seed the
//     `$event.damagedPermanent` its `destroy` reads.
//  2. REFUSALS — the neighbouring heads, subjects and anaphora the rows must
//     NOT read, each behind a body the accepted head compiles, so the refusal
//     is the head's own.
//
// The engine half (does the rebuilt ability FIRE on the right event?) is
// `gre/__tests__/compiledCombatRoleTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const GOLDENS: readonly (readonly [string, OracleCard, object])[] = [
    [
        "becomes blocked, 'it' is the source (CR 509.3c)",
        {
            oracleId: "ca8060a7-30e7-49a4-a720-da5b995dd31f",
            name: "Deepwood Wolverine",
            manaCost: "{G}",
            typeLine: "Creature — Wolverine",
            oracleText:
                "Whenever this creature becomes blocked, it gets +2/+0 until end of turn.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        {
            name: "Deepwood Wolverine",
            types: ["Creature"],
            subtypes: ["Wolverine"],
            manaCost: { G: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Whenever this creature becomes blocked, it gets +2/+0 until end of turn.",
            compiledTriggeredAbilities: [
                {
                    id: "deepwood-wolverine-trigger",
                    oracleText:
                        "Whenever this creature becomes blocked, it gets +2/+0 until end of turn.",
                    head: { kind: "becomes-blocked" },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 2,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "becomes blocked, 'defending player' is the source's opponent (CR 508.5)",
        {
            oracleId: "708b13ef-f297-4176-9d09-e633c4d600da",
            name: "Vedalken Ghoul",
            manaCost: "{U}{B}",
            typeLine: "Creature — Vedalken Zombie",
            oracleText:
                "Whenever this creature becomes blocked, defending player loses 4 life.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        {
            name: "Vedalken Ghoul",
            types: ["Creature"],
            subtypes: ["Vedalken", "Zombie"],
            manaCost: { U: 1, B: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Whenever this creature becomes blocked, defending player loses 4 life.",
            compiledTriggeredAbilities: [
                {
                    id: "vedalken-ghoul-trigger",
                    oracleText:
                        "Whenever this creature becomes blocked, defending player loses 4 life.",
                    head: { kind: "becomes-blocked" },
                    effects: [
                        { op: "loseLife", player: "opponent", amount: 4 },
                    ],
                },
            ],
        },
    ],
    [
        "becomes blocked, 'defending player controls' narrows a target (CR 508.5)",
        {
            oracleId: "c3bd1d38-e73f-4e30-b22a-dca0a0e4d701",
            name: "Rust Scarab",
            manaCost: "{4}{G}",
            typeLine: "Creature — Insect",
            oracleText:
                "Whenever this creature becomes blocked, you may destroy target artifact or enchantment defending player controls.",
            power: "4",
            toughness: "5",
            layout: "normal",
        },
        {
            name: "Rust Scarab",
            types: ["Creature"],
            subtypes: ["Insect"],
            manaCost: { X: 4, G: 1 },
            power: 4,
            toughness: 5,
            oracleText:
                "Whenever this creature becomes blocked, you may destroy target artifact or enchantment defending player controls.",
            compiledTriggeredAbilities: [
                {
                    id: "rust-scarab-trigger",
                    oracleText:
                        "Whenever this creature becomes blocked, you may destroy target artifact or enchantment defending player controls.",
                    head: { kind: "becomes-blocked" },
                    targetRequirement: {
                        type: ["Artifact", "Enchantment"],
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Destroy target artifact or enchantment defending player controls?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
        },
    ],
    [
        "attacks or blocks, the source's own (CR 508.3a + CR 509.3a)",
        {
            oracleId: "1a60dc0f-e387-4d28-8ff0-c3f1883d0c5d",
            name: "Hamlet Captain",
            manaCost: "{1}{G}",
            typeLine: "Creature — Human Warrior",
            oracleText:
                "Whenever this creature attacks or blocks, other Humans you control get +1/+1 until end of turn.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        {
            name: "Hamlet Captain",
            types: ["Creature"],
            subtypes: ["Human", "Warrior"],
            manaCost: { X: 1, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "Whenever this creature attacks or blocks, other Humans you control get +1/+1 until end of turn.",
            compiledTriggeredAbilities: [
                {
                    id: "hamlet-captain-trigger",
                    oracleText:
                        "Whenever this creature attacks or blocks, other Humans you control get +1/+1 until end of turn.",
                    head: { kind: "attacks-or-blocks", scope: "self" },
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { subtype: "Human" },
                                excludeSource: true,
                            },
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$each" },
                                    power: 1,
                                    toughness: 1,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    [
        "attacks alone (CR 506.5)",
        {
            oracleId: "17df95b2-49ef-43ca-b3c8-66a270f457a7",
            name: "Rogue Kavu",
            manaCost: "{1}{R}",
            typeLine: "Creature — Kavu",
            oracleText:
                "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
            power: "1",
            toughness: "1",
            layout: "normal",
        },
        {
            name: "Rogue Kavu",
            types: ["Creature"],
            subtypes: ["Kavu"],
            manaCost: { X: 1, R: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
            compiledTriggeredAbilities: [
                {
                    id: "rogue-kavu-trigger",
                    oracleText:
                        "Whenever this creature attacks alone, it gets +2/+0 until end of turn.",
                    head: { kind: "attacks", alone: true },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 2,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "deals combat damage to a creature, 'that creature' is the damaged one (CR 510.2)",
        {
            oracleId: "5b2e1105-5af0-4f34-bfe9-15a2f6881edd",
            name: "Voracious Cobra",
            manaCost: "{2}{R}{G}",
            typeLine: "Creature — Snake",
            oracleText:
                "First strike\nWhenever this creature deals combat damage to a creature, destroy that creature.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        {
            name: "Voracious Cobra",
            types: ["Creature"],
            subtypes: ["Snake"],
            manaCost: { X: 2, R: 1, G: 1 },
            power: 2,
            toughness: 2,
            oracleText:
                "First strike\nWhenever this creature deals combat damage to a creature, destroy that creature.",
            staticAbilities: ["first strike"],
            compiledTriggeredAbilities: [
                {
                    id: "voracious-cobra-trigger",
                    oracleText:
                        "Whenever this creature deals combat damage to a creature, destroy that creature.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "creature",
                        combat: true,
                    },
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$event.damagedPermanent" },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "deals combat damage to a creature, the can't-be-regenerated rider reads it too (CR 701.19c)",
        {
            oracleId: "bf0c85d7-16a0-46a5-a3a6-5591849bef60",
            name: "Dripping Dead",
            manaCost: "{4}{B}{B}",
            typeLine: "Creature — Zombie",
            oracleText:
                "This creature can't block.\nWhenever this creature deals combat damage to a creature, destroy that creature. It can't be regenerated.",
            power: "4",
            toughness: "1",
            layout: "normal",
        },
        {
            name: "Dripping Dead",
            types: ["Creature"],
            subtypes: ["Zombie"],
            manaCost: { X: 4, B: 2 },
            power: 4,
            toughness: 1,
            oracleText:
                "This creature can't block.\nWhenever this creature deals combat damage to a creature, destroy that creature. It can't be regenerated.",
            compiledTriggeredAbilities: [
                {
                    id: "dripping-dead-trigger",
                    oracleText:
                        "Whenever this creature deals combat damage to a creature, destroy that creature. It can't be regenerated.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "creature",
                        combat: true,
                    },
                    effects: [
                        {
                            op: "destroy",
                            target: { ref: "$event.damagedPermanent" },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "block-restriction",
                    id: "dripping-dead-cant-block",
                    oracleText: "This creature can't block.",
                },
            ],
        },
    ],
    [
        "combat on each opponent's turn, 'that player controls' is that opponent's (CR 102.2)",
        {
            oracleId: "572b1aeb-d2a0-433d-b167-86e683c2127d",
            name: "Sentinel of the Eternal Watch",
            manaCost: "{5}{W}",
            typeLine: "Creature — Giant Soldier",
            oracleText:
                "Vigilance (Attacking doesn't cause this creature to tap.)\nAt the beginning of combat on each opponent's turn, tap target creature that player controls.",
            power: "4",
            toughness: "6",
            layout: "normal",
        },
        {
            name: "Sentinel of the Eternal Watch",
            types: ["Creature"],
            subtypes: ["Giant", "Soldier"],
            manaCost: { X: 5, W: 1 },
            power: 4,
            toughness: 6,
            oracleText:
                "Vigilance (Attacking doesn't cause this creature to tap.)\nAt the beginning of combat on each opponent's turn, tap target creature that player controls.",
            staticAbilities: ["vigilance"],
            compiledTriggeredAbilities: [
                {
                    id: "sentinel-of-the-eternal-watch-trigger",
                    oracleText:
                        "At the beginning of combat on each opponent's turn, tap target creature that player controls.",
                    head: {
                        kind: "phase",
                        phase: "BEGINNING_OF_COMBAT",
                        scope: "opponents",
                    },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { target: 0 },
                        },
                    ],
                },
            ],
        },
    ],
];

function creature(oracleText: string) {
    return oracleCard({
        name: "Test Beast",
        manaCost: "{2}{G}",
        typeLine: "Creature — Beast",
        oracleText,
        power: "2",
        toughness: "2",
    });
}

describe("combat-role trigger heads — goldens", () => {
    it.each(GOLDENS)("%s", (_form, card, expected) => {
        const outcome = compileCard(card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
    });
});

describe("combat-role trigger heads — refused neighbours", () => {
    it.each([
        // CR 509.3d — counts per blocking creature, not once.
        [
            "becomes blocked BY a creature",
            "Whenever this creature becomes blocked by a creature, it gets +2/+0 until end of turn.",
        ],
        [
            "blocks or becomes blocked",
            "Whenever this creature blocks or becomes blocked, it gets +2/+0 until end of turn.",
        ],
        [
            "the 'when' opener on becomes blocked",
            "When this creature becomes blocked, it gets +2/+0 until end of turn.",
        ],
        [
            "a subject other than the source becomes blocked",
            "Whenever a creature you control becomes blocked, you gain 1 life.",
        ],
        [
            "a subject other than the source attacks or blocks",
            "Whenever a creature you control attacks or blocks, you gain 1 life.",
        ],
        // CR 702.83a — the exalted head names another creature.
        [
            "a creature you control attacks alone",
            "Whenever a creature you control attacks alone, you gain 1 life.",
        ],
        [
            "attacks or blocks alone",
            "Whenever this creature attacks or blocks alone, it gets +2/+0 until end of turn.",
        ],
        [
            "blocks alone",
            "Whenever this creature blocks alone, it gets +2/+0 until end of turn.",
        ],
        [
            "combat damage to a narrower creature",
            "Whenever this creature deals combat damage to a Dragon, you gain 1 life.",
        ],
        [
            "combat damage to a creature or opponent",
            "Whenever this creature deals combat damage to a creature or opponent, you gain 1 life.",
        ],
        [
            "combat on each player's turn",
            "At the beginning of combat on each player's turn, you gain 1 life.",
        ],
        [
            "combat on each opponent's turn, 'each combat'",
            "At the beginning of each combat, you gain 1 life.",
        ],
    ])("head: %s", (_form, text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });

    it.each([
        // CR 608.2h — two creatures are named; "it" is a guess between them.
        [
            "'it' behind combat damage to a creature",
            "Whenever this creature deals combat damage to a creature, it gets +2/+0 until end of turn.",
        ],
        [
            "'it' behind damage of any kind to a creature",
            "Whenever this creature deals damage to a creature, it gets +2/+0 until end of turn.",
        ],
        // CR 506.2 — a blocking source's controller IS the defending player.
        [
            "'defending player' behind attacks or blocks",
            "Whenever this creature attacks or blocks, defending player loses 1 life.",
        ],
        [
            "'defending player controls' behind attacks or blocks",
            "Whenever this creature attacks or blocks, destroy target artifact defending player controls.",
        ],
        // CR 608.2h — no head named an opponent.
        [
            "'that player controls' behind combat on your turn",
            "At the beginning of combat on your turn, tap target creature that player controls.",
        ],
        [
            "'that player controls' behind each player's upkeep",
            "At the beginning of each player's upkeep, tap target creature that player controls.",
        ],
        [
            "'that player controls' on an activated ability",
            "{T}: Tap target creature that player controls.",
        ],
        [
            "'that creature' behind combat damage to a player",
            "Whenever this creature deals combat damage to a player, destroy that creature.",
        ],
    ])("anaphora: %s", (_form, text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });

    it("'defending player' behind attacks or blocks, the source printed by name", () => {
        const card = oracleCard({
            name: "Testa",
            manaCost: "{2}{G}",
            typeLine: "Legendary Creature — Beast",
            oracleText:
                "Whenever Testa attacks or blocks, destroy target artifact defending player controls.",
            power: "2",
            toughness: "2",
        });
        expect(compileCard(card).state).toBe("unparsed");
        expect(
            compileCard({
                ...card,
                oracleText:
                    "Whenever Testa attacks, destroy target artifact defending player controls.",
            }).state
        ).toBe("ready");
    });
});
