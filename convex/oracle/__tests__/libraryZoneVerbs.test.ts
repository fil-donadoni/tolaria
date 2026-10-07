// Library-zone verbs: mill (CR 701.17a), put cards from the hand on top of the
// library (CR 401.4), shuffle this spell into its owner's library (CR 701.24a)
// and explore (CR 701.44a) — issue #4525.
//
// Two layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form.
//  2. REFUSALS — the neighbours these rules do not read stay `unparsed`
//     (fail-closed, ADR 0105 § 2).
//
// `exileTopOfLibrary` is not here: no corpus card whose every line compiles
// prints a bare "Exile the top N cards of your library", so there is no whole
// card to pin a golden to (issue #4525's PR names the follow-up).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectUnparsed(oracleText: string, typeLine = "Instant") {
    const outcome = compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{U}",
            typeLine,
            oracleText,
            ...(typeLine.startsWith("Creature")
                ? { power: "1", toughness: "1" }
                : { power: undefined, toughness: undefined }),
        })
    );
    expect(outcome.state).toBe("unparsed");
}

describe("library-zone verbs — golden fixtures", () => {
    it("target player mills N (activated, announced target): Millstone", () => {
        const card = oracleCard({
            oracleId: "3212e47a-5492-4c50-9d4a-6ea562f1a6e1",
            name: "Millstone",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText: "{2}, {T}: Target player mills two cards.",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Millstone",
                types: ["Artifact"],
                manaCost: {
                    X: 2,
                },
                oracleText: "{2}, {T}: Target player mills two cards.",
                activatedAbilities: [
                    {
                        id: "millstone-ability",
                        oracleText: "{2}, {T}: Target player mills two cards.",
                        cost: {
                            mana: {
                                X: 2,
                            },
                            tap: true,
                        },
                        useStack: true,
                        effects: [
                            {
                                op: "mill",
                                player: {
                                    target: 0,
                                },
                                count: 2,
                            },
                        ],
                        targetRequirement: {
                            type: "player",
                            count: 1,
                        },
                    },
                ],
            })
        );
    });

    it("own mill at an upkeep head: Tolarian Serpent", () => {
        const card = oracleCard({
            oracleId: "684e18bf-1390-4d12-8e7a-e8562db64dbb",
            name: "Tolarian Serpent",
            manaCost: "{5}{U}{U}",
            typeLine: "Creature — Serpent",
            oracleText: "At the beginning of your upkeep, mill seven cards.",
            power: "7",
            toughness: "7",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Tolarian Serpent",
                types: ["Creature"],
                subtypes: ["Serpent"],
                manaCost: {
                    X: 5,
                    U: 2,
                },
                power: 7,
                toughness: 7,
                oracleText:
                    "At the beginning of your upkeep, mill seven cards.",
                compiledTriggeredAbilities: [
                    {
                        id: "tolarian-serpent-trigger",
                        oracleText:
                            "At the beginning of your upkeep, mill seven cards.",
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "your",
                        },
                        effects: [
                            {
                                op: "mill",
                                player: "controller",
                                count: 7,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("bare imperative mill, then a draw: Mental Note", () => {
        const card = oracleCard({
            oracleId: "e8d5f31c-7abf-4fbb-977e-8353a97daf7a",
            name: "Mental Note",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText: "Mill two cards.\nDraw a card.",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Mental Note",
                types: ["Instant"],
                manaCost: {
                    U: 1,
                },
                oracleText: "Mill two cards.\nDraw a card.",
                effects: [
                    {
                        op: "mill",
                        player: "controller",
                        count: 2,
                    },
                    {
                        op: "draw",
                        player: "controller",
                        count: 1,
                    },
                ],
            })
        );
    });

    it("draw N, then put M back in any order: Brainstorm", () => {
        const card = oracleCard({
            oracleId: "36cd2364-d113-47d1-b2c4-b088d9eb88dd",
            name: "Brainstorm",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Draw three cards, then put two cards from your hand on top of your library in any order.",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Brainstorm",
                types: ["Instant"],
                manaCost: {
                    U: 1,
                },
                oracleText:
                    "Draw three cards, then put two cards from your hand on top of your library in any order.",
                effects: [
                    {
                        op: "draw",
                        player: "controller",
                        count: 3,
                    },
                    {
                        op: "putBack",
                        player: "controller",
                        count: 2,
                        prompt: "Choose two cards from your hand to put on top of your library (last picked ends up on top).",
                    },
                ],
            })
        );
    });

    it("target opponent puts a card back: Chimney Imp", () => {
        const card = oracleCard({
            oracleId: "3901bf30-b7c1-4977-a7b1-fcdafcc266cd",
            name: "Chimney Imp",
            manaCost: "{4}{B}",
            typeLine: "Creature — Imp",
            oracleText:
                "Flying\nWhen this creature dies, target opponent puts a card from their hand on top of their library.",
            power: "1",
            toughness: "2",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Chimney Imp",
                types: ["Creature"],
                subtypes: ["Imp"],
                manaCost: {
                    X: 4,
                    B: 1,
                },
                power: 1,
                toughness: 2,
                oracleText:
                    "Flying\nWhen this creature dies, target opponent puts a card from their hand on top of their library.",
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "chimney-imp-trigger",
                        oracleText:
                            "When this creature dies, target opponent puts a card from their hand on top of their library.",
                        head: {
                            kind: "died",
                            scope: "self",
                        },
                        targetRequirement: {
                            type: "player",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "putBack",
                                player: {
                                    target: 0,
                                },
                                count: 1,
                                prompt: "Choose a card from your hand to put on top of your library.",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("shuffle this spell into its owner's library: Beacon of Destruction", () => {
        const card = oracleCard({
            oracleId: "15feb59b-bbbe-462a-8d38-d20735bbc2f3",
            name: "Beacon of Destruction",
            manaCost: "{3}{R}{R}",
            typeLine: "Instant",
            oracleText:
                "Beacon of Destruction deals 5 damage to any target. Shuffle Beacon of Destruction into its owner's library.",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Beacon of Destruction",
                types: ["Instant"],
                manaCost: {
                    X: 3,
                    R: 2,
                },
                oracleText:
                    "Beacon of Destruction deals 5 damage to any target. Shuffle Beacon of Destruction into its owner's library.",
                effects: [
                    {
                        op: "dealDamage",
                        amount: 5,
                        to: {
                            target: 0,
                        },
                    },
                    {
                        op: "shuffleSelfIntoLibrary",
                    },
                ],
                targetRequirement: {
                    type: "any",
                    count: 1,
                },
            })
        );
    });

    it("target creature explores: Miner's Guidewing", () => {
        const card = oracleCard({
            oracleId: "eb161d0b-e534-463c-b1d1-7210bfba5d28",
            name: "Miner's Guidewing",
            manaCost: "{W}",
            typeLine: "Creature — Bird",
            oracleText:
                "Flying, vigilance\nWhen this creature dies, target creature you control explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on that creature, then put the card back or put it into your graveyard.)",
            power: "1",
            toughness: "1",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Miner's Guidewing",
                types: ["Creature"],
                subtypes: ["Bird"],
                manaCost: {
                    W: 1,
                },
                power: 1,
                toughness: 1,
                oracleText:
                    "Flying, vigilance\nWhen this creature dies, target creature you control explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on that creature, then put the card back or put it into your graveyard.)",
                staticAbilities: ["flying", "vigilance"],
                compiledTriggeredAbilities: [
                    {
                        id: "miner-s-guidewing-trigger",
                        oracleText:
                            "When this creature dies, target creature you control explores.",
                        head: {
                            kind: "died",
                            scope: "self",
                        },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "explore",
                                target: {
                                    target: 0,
                                },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("library-zone verbs — refused neighbours", () => {
    it("refuses a symmetric mill (Whetstone: each player mills two cards)", () => {
        expectUnparsed("{3}: Each player mills two cards.", "Artifact");
    });

    it("refuses a mill whose count is a derived quantity (Dreamborn Muse)", () => {
        expectUnparsed(
            "At the beginning of each player's upkeep, that player mills X cards, where X is the number of cards in their hand.",
            "Creature — Spirit"
        );
    });

    it("refuses a mill whose result a later sentence reads (Saprazzan Breaker)", () => {
        expectUnparsed(
            "{U}: Mill a card. If a land card was milled this way, this creature can't be blocked this turn.",
            "Creature — Beast"
        );
    });

    it("refuses an order clause that disagrees with the count (one card, in any order)", () => {
        expectUnparsed(
            "Draw a card, then put a card from your hand on top of your library in any order."
        );
    });

    it("refuses a put-back with a choice of top or bottom (Dream Cache)", () => {
        expectUnparsed(
            "Draw three cards, then put two cards from your hand both on top of your library or both on the bottom of your library."
        );
    });

    it("refuses shuffling a permanent that dies (an ability has no card to shuffle)", () => {
        expectUnparsed(
            "When this creature dies, shuffle it into its owner's library.",
            "Creature — Dragon"
        );
    });

    it("refuses shuffling the source from an ability (a creature's own trigger)", () => {
        expectUnparsed(
            "When this creature enters, shuffle this creature into its owner's library.",
            "Creature — Dragon"
        );
    });

    it("refuses a repeated explore (Jadelight Spelunker: explores X times)", () => {
        expectUnparsed(
            "When this creature enters, it explores X times.",
            "Creature — Merfolk"
        );
    });

    it("refuses an explore by a group (a sweep)", () => {
        expectUnparsed("Each creature you control explores.", "Sorcery");
    });
});
