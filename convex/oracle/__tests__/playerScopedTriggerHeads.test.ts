// Player-scoped trigger heads — "at the beginning of each opponent's upkeep",
// "at the beginning of each player's end step", "whenever a land enters",
// "whenever a player taps a land for mana" (issue #4582).
//
//  1. GOLDENS — every accepted form on a real corpus card, compiled whole and
//     compared with `sortKeys` equality. Ankh of Mishra, Tectonic Instability
//     and Sheoldred, Whispering One are `GOLDEN_FIXTURES` rows (the canned
//     smoke scenario stages neither an `$event` player nor a sweep over one),
//     read from the registry here rather than written twice.
//  2. HEAD PIN — "each player's end step": no corpus card printing it
//     compiles yet (each refuses on its own body clause), so the head is
//     pinned on a body the grammar already reads.
//  3. REFUSALS — the neighbouring heads and anaphora the rows must NOT read,
//     each behind a body the accepted head compiles, so the refusal is the
//     head's own.
//
// The engine half (does the rebuilt ability FIRE on the right event?) is
// `gre/__tests__/compiledPlayerScopedTriggers.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const GOLDENS: readonly (readonly [string, OracleCard, object])[] = [
    [
        "each opponent's upkeep, 'that player' is the opponent whose upkeep it is (CR 603.2b)",
        {
            oracleId: "05b9dccb-2364-4bca-a12e-8cb54a3f3a0b",
            name: "Viseling",
            manaCost: "{4}",
            typeLine: "Artifact Creature — Phyrexian Construct",
            oracleText:
                "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4.",
            power: "2",
            toughness: "2",
            layout: "normal",
        },
        {
            name: "Viseling",
            types: ["Artifact", "Creature"],
            subtypes: ["Phyrexian", "Construct"],
            manaCost: {
                X: 4,
            },
            power: 2,
            toughness: 2,
            oracleText:
                "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4.",
            compiledTriggeredAbilities: [
                {
                    id: "viseling-trigger",
                    oracleText:
                        "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "opponents",
                    },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: {
                                difference: {
                                    from: {
                                        count: {
                                            zone: "hand",
                                            controller: {
                                                ref: "$event.activePlayerId",
                                            },
                                        },
                                    },
                                    minus: 4,
                                },
                            },
                            to: {
                                player: {
                                    ref: "$event.activePlayerId",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a player taps a land for mana, 'that player' tapped it (CR 106.12)",
        {
            oracleId: "0f1afedd-c60f-454f-b84a-c8117aec0128",
            name: "Manabarbs",
            manaCost: "{3}{R}",
            typeLine: "Enchantment",
            oracleText:
                "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
            layout: "normal",
        },
        {
            name: "Manabarbs",
            types: ["Enchantment"],
            manaCost: {
                X: 3,
                R: 1,
            },
            oracleText:
                "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
            compiledTriggeredAbilities: [
                {
                    id: "manabarbs-trigger",
                    oracleText:
                        "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
                    head: {
                        kind: "tapped-for-mana",
                        scope: "any",
                    },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: 1,
                            to: {
                                player: {
                                    ref: "$event.controllerId",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
    [
        "a land enters, no anaphora (CR 603.6a)",
        {
            oracleId: "5b5b9390-bb3a-4f71-809a-cfe2a6566b59",
            name: "Sarinth Greatwurm",
            manaCost: "{4}{R}{G}",
            typeLine: "Creature — Wurm",
            oracleText:
                "Trample\nWhenever a land enters, create a tapped Powerstone token. (It's an artifact with \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")",
            power: "7",
            toughness: "6",
            layout: "normal",
        },
        {
            name: "Sarinth Greatwurm",
            types: ["Creature"],
            subtypes: ["Wurm"],
            manaCost: {
                X: 4,
                R: 1,
                G: 1,
            },
            power: 7,
            toughness: 6,
            oracleText:
                "Trample\nWhenever a land enters, create a tapped Powerstone token. (It's an artifact with \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")",
            staticAbilities: ["trample"],
            compiledTriggeredAbilities: [
                {
                    id: "sarinth-greatwurm-trigger",
                    oracleText:
                        "Whenever a land enters, create a tapped Powerstone token.",
                    head: {
                        kind: "entered",
                        scope: "any",
                        filter: {
                            types: ["Land"],
                        },
                    },
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Powerstone",
                                types: ["Artifact"],
                                subtypes: ["Powerstone"],
                                activatedAbilities: [
                                    {
                                        id: "powerstone-token-mana",
                                        oracleText:
                                            "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
                                        cost: {
                                            tap: true,
                                        },
                                        useStack: false,
                                        manaProduced: {
                                            C: 1,
                                        },
                                        manaRestriction:
                                            "not-nonartifact-spell",
                                        effects: [
                                            {
                                                op: "addMana",
                                                mana: {
                                                    C: 1,
                                                },
                                            },
                                        ],
                                    },
                                ],
                                imagePrintId:
                                    "d45fe4b6-aeaf-4f84-b660-c7b482ed8512",
                                entersTapped: true,
                            },
                            controller: "controller",
                        },
                    ],
                },
            ],
        },
    ],
];
const FIXTURE_FORMS: readonly (readonly [string, string])[] = [
    ["a land enters, 'that land's controller' (CR 110.2)", "Ankh of Mishra"],
    [
        "a land enters, 'lands its controller controls' (CR 701.26a)",
        "Tectonic Instability",
    ],
    [
        "each opponent's upkeep, 'that player' sacrifices (CR 701.21a)",
        "Sheoldred, Whispering One",
    ],
];

const artifact = (oracleText: string): OracleCard =>
    oracleCard({
        name: "Test Engine",
        manaCost: "{3}",
        typeLine: "Artifact",
        oracleText,
    });

describe("player-scoped trigger heads — goldens", () => {
    it.each(GOLDENS)("%s", (_form, card, expected) => {
        const outcome = compileCard(card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
    });

    it.each(FIXTURE_FORMS)("%s — the GOLDEN_FIXTURES row", (_form, name) => {
        const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
        expect(fixture?.rule).toBe("trigger head");
        const outcome = compileCard(fixture!.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture!.expected)
        );
    });
});

describe("player-scoped trigger heads — each player's end step names the player (CR 603.2b)", () => {
    it("'that player' is the player whose end step it is", () => {
        const outcome = compileCard(
            artifact(
                "At the beginning of each player's end step, this artifact deals 1 damage to that player."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.compiledTriggeredAbilities).toEqual([
            expect.objectContaining({
                head: { kind: "phase", phase: "END_STEP", scope: "each" },
                effects: [
                    {
                        op: "dealDamage",
                        amount: 1,
                        to: { player: { ref: "$event.activePlayerId" } },
                    },
                ],
            }),
        ]);
    });

    it("'that player' behind the unnamed 'each end step' stays refused", () => {
        expect(
            compileCard(
                artifact(
                    "At the beginning of each end step, this artifact deals 1 damage to that player."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("player-scoped trigger heads — refused neighbours", () => {
    it.each([
        [
            "each opponent's end step",
            "At the beginning of each opponent's end step, this artifact deals 1 damage to that player.",
        ],
        [
            "a land you control enters",
            "Whenever a land you control enters, you gain 1 life.",
        ],
        [
            "a land an opponent controls enters",
            "Whenever a land an opponent controls enters, you gain 1 life.",
        ],
        [
            "a player taps a creature for mana",
            "Whenever a player taps a creature for mana, this artifact deals 1 damage to that player.",
        ],
        [
            "an opponent taps a land for mana",
            "Whenever an opponent taps a land for mana, this artifact deals 1 damage to that player.",
        ],
    ])("head: %s", (_form, text) => {
        expect(compileCard(artifact(text)).state).toBe("unparsed");
    });

    it.each([
        // CR 102.2 — "each player's end step" names a player, not an opponent.
        [
            "'that opponent' behind each player's end step",
            "At the beginning of each player's end step, this artifact deals 1 damage to that opponent.",
        ],
        // CR 603.6a — a land head names a land, not a player.
        [
            "'that player' behind a land enters",
            "Whenever a land enters, this artifact deals 2 damage to that player.",
        ],
        // CR 110.2 — no land was named by a creature head.
        [
            "'that land's controller' behind a creature enters",
            "Whenever a creature enters, this artifact deals 2 damage to that land's controller.",
        ],
        [
            "'lands its controller controls' behind a creature enters",
            "Whenever a creature enters, tap all lands its controller controls.",
        ],
        // CR 608.2h — after a sentence that acted on another object, "its"
        // may mean that object: the head's land is withheld there.
        [
            "'its controller' in a later sentence behind a land enters",
            "Whenever a land enters, destroy target creature. Tap all lands its controller controls.",
        ],
        [
            "'untap all lands its controller controls'",
            "Whenever a land enters, untap all lands its controller controls.",
        ],
        // issue #3742 — the produced mana is no Effect Script value.
        [
            "'adds one mana of any type that land produced'",
            "Whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
        ],
    ])("anaphora: %s", (_form, text) => {
        expect(compileCard(artifact(text)).state).toBe("unparsed");
    });
});
