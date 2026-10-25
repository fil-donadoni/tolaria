// "When you do" — the reflexive ability behind an action it triggers off
// (CR 603.12, issue #4531).
//
// Three layers:
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition: the action, the gate on the evidence it was
//     performed, and a `reflexiveTrigger` announcing its own target.
//  2. REFUSALS — a "When you do" with no action behind it to trigger off, and a
//     body reading a binding of the resolving ability, stay unparsed.
//  3. LOWERING invariants — the reflexive target indexes from ITS OWN slot 0.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const GOLDENS: ReadonlyArray<readonly [string, object, object]> = [
    // an optional sacrifice, a targeted body
    [
        "Ruthless Lawbringer",
        {
            oracleId: "82b6a283-9897-4ce1-8de3-e7579cc9b75b",
            name: "Ruthless Lawbringer",
            manaCost: "{1}{W}{B}",
            typeLine: "Creature — Vampire Assassin",
            oracleText:
                "When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.",
            power: "3",
            toughness: "2",
            layout: "normal",
        },
        {
            name: "Ruthless Lawbringer",
            types: ["Creature"],
            subtypes: ["Vampire", "Assassin"],
            manaCost: { X: 1, W: 1, B: 1 },
            power: 3,
            toughness: 2,
            oracleText:
                "When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.",
            compiledTriggeredAbilities: [
                {
                    id: "ruthless-lawbringer-trigger",
                    oracleText:
                        "When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Sacrifice another creature?",
                            bind: "$may2",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may2" },
                            then: [
                                {
                                    op: "choice",
                                    kind: "sacrifice-permanents",
                                    player: "controller",
                                    zone: "battlefield",
                                    filter: {
                                        type: "Creature",
                                        excludeSource: true,
                                    },
                                    count: 1,
                                    prompt: "Sacrifice another creature.",
                                    bind: "$sacrifice1",
                                },
                                {
                                    op: "sacrifice",
                                    permanents: { ref: "$sacrifice1" },
                                    bind: "$did3",
                                },
                                {
                                    op: "if",
                                    predicate: {
                                        boundMatchesFilter: { ref: "$did3" },
                                        filter: {},
                                    },
                                    then: [
                                        {
                                            op: "reflexiveTrigger",
                                            oracleText:
                                                "When you do, destroy target nonland permanent.",
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
                                                excludeTypes: ["Land"],
                                            },
                                            effects: [
                                                {
                                                    op: "destroy",
                                                    target: { target: 0 },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    // an optional sacrifice, the source dealing damage
    [
        "Cornered Crook",
        {
            oracleId: "4477eeab-a51a-4dc2-9c97-83f2551d8b54",
            name: "Cornered Crook",
            manaCost: "{4}{R}",
            typeLine: "Creature — Lizard Warrior",
            oracleText:
                "When this creature enters, you may sacrifice an artifact. When you do, this creature deals 3 damage to any target.",
            power: "5",
            toughness: "4",
            layout: "normal",
        },
        {
            name: "Cornered Crook",
            types: ["Creature"],
            subtypes: ["Lizard", "Warrior"],
            manaCost: { X: 4, R: 1 },
            power: 5,
            toughness: 4,
            oracleText:
                "When this creature enters, you may sacrifice an artifact. When you do, this creature deals 3 damage to any target.",
            compiledTriggeredAbilities: [
                {
                    id: "cornered-crook-trigger",
                    oracleText:
                        "When this creature enters, you may sacrifice an artifact. When you do, this creature deals 3 damage to any target.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Sacrifice an artifact?",
                            bind: "$may2",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may2" },
                            then: [
                                {
                                    op: "choice",
                                    kind: "sacrifice-permanents",
                                    player: "controller",
                                    zone: "battlefield",
                                    filter: { type: "Artifact" },
                                    count: 1,
                                    prompt: "Sacrifice an artifact.",
                                    bind: "$sacrifice1",
                                },
                                {
                                    op: "sacrifice",
                                    permanents: { ref: "$sacrifice1" },
                                    bind: "$did3",
                                },
                                {
                                    op: "if",
                                    predicate: {
                                        boundMatchesFilter: { ref: "$did3" },
                                        filter: {},
                                    },
                                    then: [
                                        {
                                            op: "reflexiveTrigger",
                                            oracleText:
                                                "When you do, this creature deals 3 damage to any target.",
                                            targetRequirement: {
                                                type: "any",
                                                count: 1,
                                            },
                                            effects: [
                                                {
                                                    op: "dealDamage",
                                                    amount: 3,
                                                    to: { target: 0 },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    // an optional exile of itself, a target in the graveyard
    [
        "Undead Butler",
        {
            oracleId: "426fa8e8-b0f9-4b6c-b22b-04ec2073187a",
            name: "Undead Butler",
            manaCost: "{1}{B}",
            typeLine: "Creature — Zombie",
            oracleText:
                "When this creature enters, mill three cards. (Put the top three cards of your library into your graveyard.)\nWhen this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand.",
            power: "1",
            toughness: "2",
            layout: "normal",
        },
        {
            name: "Undead Butler",
            types: ["Creature"],
            subtypes: ["Zombie"],
            manaCost: { X: 1, B: 1 },
            power: 1,
            toughness: 2,
            oracleText:
                "When this creature enters, mill three cards. (Put the top three cards of your library into your graveyard.)\nWhen this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand.",
            compiledTriggeredAbilities: [
                {
                    id: "undead-butler-trigger",
                    oracleText: "When this creature enters, mill three cards.",
                    head: { kind: "entered", scope: "self" },
                    effects: [{ op: "mill", player: "controller", count: 3 }],
                },
                {
                    id: "undead-butler-trigger-2",
                    oracleText:
                        "When this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand.",
                    head: { kind: "died", scope: "self" },
                    effects: [
                        {
                            op: "mayPay",
                            player: "controller",
                            prompt: "Exile it?",
                            bind: "$may1",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$may1" },
                            then: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$source" },
                                    to: "exile",
                                    bind: "$did2",
                                },
                                {
                                    op: "if",
                                    predicate: {
                                        boundMatchesFilter: { ref: "$did2" },
                                        filter: {},
                                    },
                                    then: [
                                        {
                                            op: "reflexiveTrigger",
                                            oracleText:
                                                "When you do, return target creature card from your graveyard to your hand.",
                                            targetRequirement: {
                                                type: "Creature",
                                                count: 1,
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
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    // the controller's own unconditional sacrifice
    [
        "Smoke Bomb",
        {
            oracleId: "c262e015-f379-484f-894f-1a1deb3c75cc",
            name: "Smoke Bomb",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText:
                "Flash\nAll creatures have shroud. (They can't be the targets of spells or abilities.)\nAt the beginning of your upkeep, sacrifice this artifact. When you do, target creature you control can't be blocked this turn.",
            layout: "normal",
        },
        {
            name: "Smoke Bomb",
            types: ["Artifact"],
            manaCost: { X: 3 },
            oracleText:
                "Flash\nAll creatures have shroud. (They can't be the targets of spells or abilities.)\nAt the beginning of your upkeep, sacrifice this artifact. When you do, target creature you control can't be blocked this turn.",
            staticAbilities: ["flash"],
            compiledTriggeredAbilities: [
                {
                    id: "smoke-bomb-trigger",
                    oracleText:
                        "At the beginning of your upkeep, sacrifice this artifact. When you do, target creature you control can't be blocked this turn.",
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    effects: [
                        {
                            op: "sacrifice",
                            target: { ref: "$source" },
                            bind: "$sacrificed1",
                        },
                        {
                            op: "if",
                            predicate: {
                                boundMatchesFilter: { ref: "$sacrificed1" },
                                filter: {},
                            },
                            then: [
                                {
                                    op: "reflexiveTrigger",
                                    oracleText:
                                        "When you do, target creature you control can't be blocked this turn.",
                                    targetRequirement: {
                                        type: "Creature",
                                        count: 1,
                                        controller: "you",
                                    },
                                    effects: [
                                        {
                                            op: "restrictCombat",
                                            restriction: "cant-be-blocked",
                                            target: { target: 0 },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    filter: { types: ["Creature"] },
                    keyword: "shroud",
                },
            ],
        },
    ],
];

describe("When you do — reflexive trigger (CR 603.12)", () => {
    it.each(GOLDENS)(
        "%s compiles to its golden definition",
        (_name, card, expected) => {
            const outcome = compileCard(card as ReturnType<typeof oracleCard>);
            if (outcome.state === "unparsed")
                throw new Error(JSON.stringify(outcome.gaps));
            expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
        }
    );

    function trigger(oracleText: string) {
        return compileCard(
            oracleCard({
                name: "Test Card",
                typeLine: "Creature — Bear",
                oracleText,
            })
        );
    }

    it("refuses a reflexive ability behind an action that is no sacrifice or optional action", () => {
        expect(
            trigger(
                "When this creature enters, draw a card. When you do, destroy target creature."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a reflexive ability with no action before it", () => {
        expect(trigger("When you do, destroy target creature.").state).toBe(
            "unparsed"
        );
    });

    it("refuses a body that reads the sacrificed creature (no capture to carry it, CR 608.2h)", () => {
        expect(
            trigger(
                "When this creature enters, you may sacrifice another creature. When you do, this creature deals damage to any target equal to that creature's power."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a second target group in the reflexive ability (CR 603.3d)", () => {
        expect(
            trigger(
                "When this creature enters, you may sacrifice another creature. When you do, destroy target creature and tap target land."
            ).state
        ).toBe("unparsed");
    });

    it("announces the reflexive target from its own slot 0", () => {
        const outcome = trigger(
            "When this creature enters, you may sacrifice another creature. When you do, destroy target nonland permanent."
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const text = JSON.stringify(outcome.definition);
        expect(text).toContain('"op":"reflexiveTrigger"');
        expect(text).toContain(
            '"effects":[{"op":"destroy","target":{"target":0}}]'
        );
    });
});
