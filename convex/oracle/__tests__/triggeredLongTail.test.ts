// Triggered long tail: the clause forms of the premodern-metagame cluster
// (issue #4571) — a named-kicker gate on an ETB trigger, "untap up to N
// lands", "where X is …" counts, and a pump per other attacking creature.
//
// Two layers: GOLDENS (a real corpus card compiled whole equals its full
// Compiled Definition) and REFUSALS (the neighbouring forms stay `unparsed`,
// so fail-closed is pinned, not assumed — ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const GOLDENS: readonly {
    readonly card: OracleCard;
    readonly expected: CompiledDefinition;
}[] = [
    // a named-kicker gate on an ETB trigger (CR 702.33e/f, CR 603.4): a check-time `kicker-paid` condition plus the resolution-time `additionalCostPaid` branch
    {
        card: {
            name: "Thornscape Battlemage",
            manaCost: "{2}{G}",
            typeLine: "Creature — Elf Wizard",
            oracleText:
                "Kicker {R} and/or {W} (You may pay an additional {R} and/or {W} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.\nWhen this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
            power: "2",
            toughness: "2",
            oracleId: "8d4d6806-cb01-49e3-91cc-fb0e7f7a8684",
            layout: "normal",
        },
        expected: {
            name: "Thornscape Battlemage",
            types: ["Creature"],
            subtypes: ["Elf", "Wizard"],
            manaCost: {
                X: 2,
                G: 1,
            },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {R} and/or {W} (You may pay an additional {R} and/or {W} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.\nWhen this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
            compiledTriggeredAbilities: [
                {
                    id: "thornscape-battlemage-trigger",
                    oracleText:
                        "When this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    condition: {
                        kind: "kicker-paid",
                        kickerId: "kicker-r",
                    },
                    targetRequirement: {
                        type: "any",
                        count: 1,
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    additionalCostPaid: "kicker-r",
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "dealDamage",
                                    amount: 2,
                                    to: {
                                        target: 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "thornscape-battlemage-trigger-2",
                    oracleText:
                        "When this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    condition: {
                        kind: "kicker-paid",
                        kickerId: "kicker-w",
                    },
                    targetRequirement: {
                        type: "Artifact",
                        count: 1,
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    additionalCostPaid: "kicker-w",
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "destroy",
                                    target: {
                                        target: 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker-r",
                    description: "Kicker {R}",
                    mana: {
                        R: 1,
                    },
                },
                {
                    id: "kicker-w",
                    description: "Kicker {W}",
                    mana: {
                        W: 1,
                    },
                },
            ],
        },
    },
    // the same gate on a second kicker pair and a targeted destroy
    {
        card: {
            name: "Sunscape Battlemage",
            manaCost: "{2}{W}",
            typeLine: "Creature — Human Wizard",
            oracleText:
                "Kicker {1}{G} and/or {2}{U} (You may pay an additional {1}{G} and/or {2}{U} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.\nWhen this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
            power: "2",
            toughness: "2",
            oracleId: "c8fd2232-e499-4889-a2ca-e486ea87d02b",
            layout: "normal",
        },
        expected: {
            name: "Sunscape Battlemage",
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            manaCost: {
                X: 2,
                W: 1,
            },
            power: 2,
            toughness: 2,
            oracleText:
                "Kicker {1}{G} and/or {2}{U} (You may pay an additional {1}{G} and/or {2}{U} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.\nWhen this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
            compiledTriggeredAbilities: [
                {
                    id: "sunscape-battlemage-trigger",
                    oracleText:
                        "When this creature enters, if it was kicked with its {1}{G} kicker, destroy target creature with flying.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    condition: {
                        kind: "kicker-paid",
                        kickerId: "kicker-g",
                    },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        requireAbility: "flying",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    additionalCostPaid: "kicker-g",
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "destroy",
                                    target: {
                                        target: 0,
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "sunscape-battlemage-trigger-2",
                    oracleText:
                        "When this creature enters, if it was kicked with its {2}{U} kicker, draw two cards.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    condition: {
                        kind: "kicker-paid",
                        kickerId: "kicker-u",
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    additionalCostPaid: "kicker-u",
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "draw",
                                    player: "controller",
                                    count: 2,
                                },
                            ],
                        },
                    ],
                },
            ],
            kickers: [
                {
                    id: "kicker-g",
                    description: "Kicker {1}{G}",
                    mana: {
                        X: 1,
                        G: 1,
                    },
                },
                {
                    id: "kicker-u",
                    description: "Kicker {2}{U}",
                    mana: {
                        X: 2,
                        U: 1,
                    },
                },
            ],
        },
    },
    // untap up to N lands: a ranged all-battlefields choice, then a forEach untap (CR 701.26b)
    {
        card: {
            name: "Palinchron",
            manaCost: "{5}{U}{U}",
            typeLine: "Creature — Illusion",
            oracleText:
                "Flying\nWhen this creature enters, untap up to seven lands.\n{2}{U}{U}: Return this creature to its owner's hand.",
            power: "4",
            toughness: "5",
            oracleId: "0023888e-7bec-43e0-8dee-d1a4eb94b372",
            layout: "normal",
        },
        expected: {
            name: "Palinchron",
            types: ["Creature"],
            subtypes: ["Illusion"],
            manaCost: {
                X: 5,
                U: 2,
            },
            power: 4,
            toughness: 5,
            oracleText:
                "Flying\nWhen this creature enters, untap up to seven lands.\n{2}{U}{U}: Return this creature to its owner's hand.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "palinchron-ability",
                    oracleText:
                        "{2}{U}{U}: Return this creature to its owner's hand.",
                    cost: {
                        mana: {
                            X: 2,
                            U: 2,
                        },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: {
                                ref: "$source",
                            },
                            to: "hand",
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "palinchron-trigger",
                    oracleText:
                        "When this creature enters, untap up to seven lands.",
                    head: {
                        kind: "entered",
                        scope: "self",
                    },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: "controller",
                            zone: "battlefield",
                            allControllers: true,
                            filter: {
                                type: "Land",
                            },
                            count: {
                                min: 0,
                                max: 7,
                            },
                            prompt: "Untap up to seven lands.",
                            bind: "$untapped1",
                        },
                        {
                            op: "forEach",
                            select: {
                                set: "bound",
                                ref: "$untapped1",
                            },
                            effects: [
                                {
                                    op: "tapUntap",
                                    action: "untap",
                                    target: {
                                        ref: "$each",
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    // a life gain whose X is a hand count minus a constant (CR 107.1b)
    {
        card: {
            name: "Ivory Tower",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            oracleId: "d416a4ed-9f16-4a8b-8aee-03c630e1eb6c",
            layout: "normal",
        },
        expected: {
            name: "Ivory Tower",
            types: ["Artifact"],
            manaCost: {
                X: 1,
            },
            oracleText:
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
            compiledTriggeredAbilities: [
                {
                    id: "ivory-tower-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you gain X life, where X is the number of cards in your hand minus 4.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "your",
                    },
                    effects: [
                        {
                            op: "gainLife",
                            player: "controller",
                            amount: {
                                difference: {
                                    from: {
                                        count: {
                                            zone: "hand",
                                            controller: "controller",
                                        },
                                    },
                                    minus: 4,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // a draw and a life loss sharing one X defined by a plural count (CR 107.3)
    {
        card: {
            name: "Graveborn Muse",
            manaCost: "{2}{B}{B}",
            typeLine: "Creature — Zombie Spirit",
            oracleText:
                "At the beginning of your upkeep, you draw X cards and lose X life, where X is the number of Zombies you control.",
            power: "3",
            toughness: "3",
            oracleId: "d2a65ff4-ab82-42f7-9d90-feb29132121e",
            layout: "normal",
        },
        expected: {
            name: "Graveborn Muse",
            types: ["Creature"],
            subtypes: ["Zombie", "Spirit"],
            manaCost: {
                X: 2,
                B: 2,
            },
            power: 3,
            toughness: 3,
            oracleText:
                "At the beginning of your upkeep, you draw X cards and lose X life, where X is the number of Zombies you control.",
            compiledTriggeredAbilities: [
                {
                    id: "graveborn-muse-trigger",
                    oracleText:
                        "At the beginning of your upkeep, you draw X cards and lose X life, where X is the number of Zombies you control.",
                    head: {
                        kind: "phase",
                        phase: "UPKEEP",
                        scope: "your",
                    },
                    effects: [
                        {
                            op: "draw",
                            player: "controller",
                            count: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        subtype: "Zombie",
                                    },
                                },
                            },
                        },
                        {
                            op: "loseLife",
                            player: "controller",
                            amount: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: {
                                        subtype: "Zombie",
                                    },
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    // a pump scaled by the other attacking creatures of one subtype (CR 508.1)
    {
        card: {
            name: "Goblin Piledriver",
            manaCost: "{1}{R}",
            typeLine: "Creature — Goblin Warrior",
            oracleText:
                "Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)\nWhenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
            power: "1",
            toughness: "2",
            oracleId: "4d74d12b-1ffb-482f-8bac-635a8d4d32e9",
            layout: "normal",
        },
        expected: {
            name: "Goblin Piledriver",
            types: ["Creature"],
            subtypes: ["Goblin", "Warrior"],
            manaCost: {
                X: 1,
                R: 1,
            },
            power: 1,
            toughness: 2,
            oracleText:
                "Protection from blue (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue.)\nWhenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
            staticAbilities: ["protection from blue"],
            compiledTriggeredAbilities: [
                {
                    id: "goblin-piledriver-trigger",
                    oracleText:
                        "Whenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
                    head: {
                        kind: "attacks",
                    },
                    effects: [
                        {
                            op: "pump",
                            target: {
                                ref: "$source",
                            },
                            power: {
                                count: {
                                    zone: "battlefield",
                                    acrossAllPlayers: true,
                                    filter: {
                                        type: "Creature",
                                        subtype: "Goblin",
                                        isAttacking: true,
                                        excludeSource: true,
                                    },
                                    times: 2,
                                },
                            },
                            toughness: 0,
                            duration: {
                                phase: "end-of-turn",
                            },
                        },
                    ],
                },
            ],
        },
    },
];

function unparsed(oracleText: string, extra: Partial<OracleCard> = {}) {
    return (
        compileCard(oracleCard({ name: "Test Card", oracleText, ...extra }))
            .state === "unparsed"
    );
}

const BATTLEMAGE = {
    manaCost: "{2}{G}",
    typeLine: "Creature — Elf Wizard",
};
const KICKER = "Kicker {R} and/or {W}\n";

describe("triggered long tail — goldens (issue #4571)", () => {
    for (const { card, expected } of GOLDENS)
        it(`${card.name} compiles to its whole definition`, () => {
            const outcome = compileCard(card);
            if (outcome.state === "unparsed")
                throw new Error(JSON.stringify(outcome.gaps));
            expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
        });
});

describe("triggered long tail — refusals (fail-closed)", () => {
    it("refuses a kicked gate behind a head that is not this permanent entering (CR 702.33e)", () => {
        expect(
            unparsed(
                `${KICKER}Whenever another creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.`,
                BATTLEMAGE
            )
        ).toBe(true);
    });

    it("refuses an unnamed kicked gate (the aggregate tally has no check-time gate)", () => {
        expect(
            unparsed(
                `${KICKER}When this creature enters, if it was kicked, it deals 2 damage to any target.`,
                BATTLEMAGE
            )
        ).toBe(true);
    });

    it("refuses a kicker cost the card does not print (CR 702.33f)", () => {
        expect(
            unparsed(
                `${KICKER}When this creature enters, if it was kicked with its {G} kicker, it deals 2 damage to any target.`,
                BATTLEMAGE
            )
        ).toBe(true);
    });

    it("refuses 'untap up to N' over a narrowed or owned set", () => {
        for (const noun of [
            "lands you control",
            "nonbasic lands",
            "target lands",
        ])
            expect(
                unparsed(
                    `When this creature enters, untap up to seven ${noun}.`
                )
            ).toBe(true);
    });

    it("refuses a 'where X is' tail on an effect that prints no X, or a count it does not read", () => {
        expect(
            unparsed(
                "When this creature enters, destroy target creature, where X is the number of Zombies you control."
            )
        ).toBe(true);
        expect(
            unparsed(
                "At the beginning of your upkeep, you gain 2 life, where X is the number of Zombies you control."
            )
        ).toBe(true);
        expect(
            unparsed(
                "At the beginning of your upkeep, you gain X life, where X is the number of cards in your graveyard minus 4."
            )
        ).toBe(true);
    });

    it("refuses an elided-subject draw conjunction past the draw-and-lose-life pair (CR 608.2c)", () => {
        expect(
            unparsed(
                "At the beginning of your upkeep, you draw a card and discard a card."
            )
        ).toBe(true);
        expect(
            unparsed(
                "At the beginning of your upkeep, you draw a card and gain 1 life."
            )
        ).toBe(true);
    });

    it("refuses 'for each other attacking' on another creature or a non-subtype", () => {
        expect(
            unparsed(
                "Whenever this creature attacks, target creature gets +1/+0 until end of turn for each other attacking Goblin."
            )
        ).toBe(true);
        expect(
            unparsed(
                "Whenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Banana."
            )
        ).toBe(true);
    });
});

describe("the compiled kicker gate decides at the engine, per kicker (CR 603.4)", () => {
    const thornscape = GOLDENS.find(
        (g) => g.card.name === "Thornscape Battlemage"
    )!;
    const abilities = (
        thornscape.expected as unknown as CardDefinition
    ).compiledTriggeredAbilities!.map(resolveCompiledTrigger);

    const paid = (kickerId: string) =>
        ({ kickerPayments: { [kickerId]: 1 } }) as unknown as PermanentView;

    it("each trigger fires only for its own kicker's payment", () => {
        const [red, white] = abilities.map((a) =>
            a.gate !== undefined && "onSelf" in a.gate
                ? a.gate.onSelf
                : undefined
        );
        expect([red?.(paid("kicker-r")), red?.(paid("kicker-w"))]).toEqual([
            true,
            false,
        ]);
        expect([white?.(paid("kicker-w")), white?.(paid("kicker-r"))]).toEqual([
            true,
            false,
        ]);
        expect(red?.({} as unknown as PermanentView)).toBe(false);
    });
});

describe("an announced 'up to one target' untap is not the choice form", () => {
    it("Zephyr Winder keeps compiling through the target path (CR 115.1)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Zephyr Winder",
                manaCost: "{1}{U}",
                typeLine: "Creature — Elemental",
                oracleText:
                    "Flying\nWhenever this creature deals combat damage to a player, untap up to one target creature.",
            })
        );
        expect(outcome.state).not.toBe("unparsed");
    });
});
