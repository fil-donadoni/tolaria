// Hand reveal and pick: "Target opponent reveals their hand. You choose <a
// card> from it. That player discards that card." and its exile routes
// (CR 701.20a, CR 701.9b, CR 701.13a), the optional hand exile that gates an
// "If you do" (CR 608.2c), and the controller's own "Discard a card."
// (CR 701.9b) — issue #4566.
//
// Layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form. Three forms are printed
//     only on cards another line keeps unparsed (Grief's Evoke, Mesmeric
//     Fiend's linked return, Volrath's Shapeshifter's text-copying static):
//     those goldens compile the card's own printed line alone.
//  2. REFUSALS — the neighbours the corpus prints that these rules do not
//     read, so fail-closed is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import type {
    CardDefinition,
    EffectCardFilter,
    EffectOp,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

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

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const OPPONENT = {
    type: "player",
    count: 1,
    controller: "opponent",
} as const;

const REVEAL = { op: "reveal", player: { target: 0 }, zone: "hand" } as const;

function pick(phrase: string, filter?: EffectCardFilter): EffectOp {
    return {
        op: "choice",
        kind: "choose-hand-card",
        player: "controller",
        zoneOwnerId: { target: 0 },
        zone: "hand",
        ...(filter === undefined ? {} : { filter }),
        count: 1,
        prompt: `Choose ${phrase} from that player's hand.`,
        bind: "$picked1",
    };
}

const DISCARD_PICKED = {
    op: "discard",
    player: { target: 0 },
    cards: { ref: "$picked1" },
} as const;

const EXILE_PICKED = {
    op: "moveZone",
    cards: { ref: "$picked1" },
    player: { target: 0 },
    from: "hand",
    to: "exile",
} as const;

describe("Reveal a hand, pick a card — golden fixtures (CR 701.20a, CR 701.9b)", () => {
    it("discard, two-type exclusion: Duress", () => {
        const text =
            "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.";
        expectDefinition(sorcery("Duress", "{B}", text), {
            name: "Duress",
            types: ["Sorcery"],
            manaCost: { B: 1 },
            oracleText: text,
            effects: [
                REVEAL,
                pick("a noncreature, nonland card", {
                    excludeType: ["Land", "Creature"],
                }),
                DISCARD_PICKED,
            ],
            targetRequirement: OPPONENT,
        });
    });

    it("discard, any card (no filter): Coercion", () => {
        const text =
            "Target opponent reveals their hand. You choose a card from it. That player discards that card.";
        expectDefinition(sorcery("Coercion", "{2}{B}", text), {
            name: "Coercion",
            types: ["Sorcery"],
            manaCost: { X: 2, B: 1 },
            oracleText: text,
            effects: [REVEAL, pick("a card"), DISCARD_PICKED],
            targetRequirement: OPPONENT,
        });
    });

    it("exile printed in the pick: Castigate", () => {
        const text =
            "Target opponent reveals their hand. You choose a nonland card from it and exile that card.";
        expectDefinition(sorcery("Castigate", "{W}{B}", text), {
            name: "Castigate",
            types: ["Sorcery"],
            manaCost: { W: 1, B: 1 },
            oracleText: text,
            effects: [
                REVEAL,
                pick("a nonland card", { excludeType: "Land" }),
                EXILE_PICKED,
            ],
            targetRequirement: OPPONENT,
        });
    });

    it("exile as its own sentence, two-type union: Intimidation Tactics", () => {
        const spell =
            "Target opponent reveals their hand. You choose an artifact or creature card from it. Exile that card.";
        const cycling = "Cycling {3} ({3}, Discard this card: Draw a card.)";
        expectDefinition(
            sorcery("Intimidation Tactics", "{B}", `${spell}\n${cycling}`),
            {
                name: "Intimidation Tactics",
                types: ["Sorcery"],
                manaCost: { B: 1 },
                oracleText: `${spell}\n${cycling}`,
                effects: [
                    REVEAL,
                    pick("an artifact or creature card", {
                        type: ["Artifact", "Creature"],
                    }),
                    EXILE_PICKED,
                ],
                targetRequirement: OPPONENT,
                activatedAbilities: [
                    {
                        id: "cycling",
                        oracleText: cycling,
                        cost: {
                            mana: { generic: 3 },
                            discardThis: true,
                            cyclingCost: true,
                        },
                        activateFromHand: true,
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            }
        );
    });

    it("trigger, three sentences: Grief's enters line", () => {
        const text =
            "When this creature enters, target opponent reveals their hand. You choose a nonland card from it. That player discards that card.";
        expectDefinition(
            oracleCard({
                name: "Grief",
                manaCost: "{2}{B}{B}",
                typeLine: "Creature — Elemental Incarnation",
                oracleText: text,
                power: "3",
                toughness: "2",
            }),
            {
                name: "Grief",
                types: ["Creature"],
                subtypes: ["Elemental", "Incarnation"],
                manaCost: { X: 2, B: 2 },
                power: 3,
                toughness: 2,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "grief-trigger",
                        oracleText: text,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: OPPONENT,
                        effects: [
                            REVEAL,
                            pick("a nonland card", { excludeType: "Land" }),
                            DISCARD_PICKED,
                        ],
                    },
                ],
            }
        );
    });

    it("trigger, reveal and pick in one sentence: Mesmeric Fiend's enters line", () => {
        // The card's second line ("return the exiled card") is a CR 607.2a
        // linked return `linkExile.ts` refuses whole-card, so this line
        // reaching the compiler never compiles the Fiend with an unlinked exile.
        const text =
            "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.";
        expectDefinition(
            oracleCard({
                name: "Mesmeric Fiend",
                manaCost: "{1}{B}",
                typeLine: "Creature — Nightmare Horror",
                oracleText: text,
                power: "1",
                toughness: "1",
            }),
            {
                name: "Mesmeric Fiend",
                types: ["Creature"],
                subtypes: ["Nightmare", "Horror"],
                manaCost: { X: 1, B: 1 },
                power: 1,
                toughness: 1,
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "mesmeric-fiend-trigger",
                        oracleText: text,
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: OPPONENT,
                        effects: [
                            REVEAL,
                            pick("a nonland card", { excludeType: "Land" }),
                            EXILE_PICKED,
                        ],
                    },
                ],
            }
        );
    });
});

describe("Optional hand exile gating an effect — golden fixture (CR 608.2c)", () => {
    it("upkeep untap: Forsaken City", () => {
        const trigger =
            "At the beginning of your upkeep, you may exile a card from your hand. If you do, untap this land.";
        const text = `This land doesn't untap during your untap step.\n${trigger}\n{T}: Add one mana of any color.`;
        expectDefinition(
            oracleCard({
                name: "Forsaken City",
                manaCost: "",
                typeLine: "Land",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            }),
            {
                name: "Forsaken City",
                types: ["Land"],
                oracleText: text,
                staticAbilities: ["does-not-untap"],
                activatedAbilities: [
                    {
                        id: "forsaken-city-mana",
                        oracleText: "{T}: Add one mana of any color.",
                        cost: { tap: true },
                        useStack: false,
                        manaChoices: [
                            { W: 1 },
                            { U: 1 },
                            { B: 1 },
                            { R: 1 },
                            { G: 1 },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "forsaken-city-trigger",
                        oracleText: trigger,
                        head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: {
                                    hand: {
                                        action: "exile",
                                        requirements: [
                                            { filter: {}, count: 1 },
                                        ],
                                    },
                                },
                                prompt: "Exile a card from your hand?",
                                bind: "$paid1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$paid1" },
                                then: [
                                    {
                                        op: "tapUntap",
                                        action: "untap",
                                        target: { ref: "$source" },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }
        );
    });
});

describe("The controller's own discard — golden fixture (CR 701.9b)", () => {
    it("activated: Volrath's Shapeshifter's {2} line", () => {
        const text = "{2}: Discard a card.";
        expectDefinition(
            oracleCard({
                name: "Volrath's Shapeshifter",
                manaCost: "{1}{U}{U}",
                typeLine: "Creature — Phyrexian Shapeshifter",
                oracleText: text,
                power: "0",
                toughness: "1",
            }),
            {
                name: "Volrath's Shapeshifter",
                types: ["Creature"],
                subtypes: ["Phyrexian", "Shapeshifter"],
                manaCost: { X: 1, U: 2 },
                power: 0,
                toughness: 1,
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "volrath-s-shapeshifter-ability",
                        oracleText: text,
                        cost: { mana: { X: 2 } },
                        useStack: true,
                        effects: [
                            {
                                op: "choice",
                                kind: "choose-hand-card",
                                player: "controller",
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                                bind: "$discard1",
                            },
                            {
                                op: "discard",
                                player: "controller",
                                cards: { ref: "$discard1" },
                            },
                        ],
                    },
                ],
            }
        );
    });
});

describe("Hand reveal and pick — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string, string][] = [
        [
            "a pick filter with no row (mana value): Appetite for Brains",
            "Sorcery",
            "Target opponent reveals their hand. You choose a card from it with mana value 4 or greater and exile that card.",
        ],
        [
            "a pick filter with no row (nonlegendary): Lay Bare the Heart",
            "Sorcery",
            "Target opponent reveals their hand. You choose a nonlegendary, nonland card from it. That player discards that card.",
        ],
        [
            "an optional pick: Binding Negotiation",
            "Sorcery",
            "Target opponent reveals their hand. You may choose a nonland card from it. If you do, they discard it. Otherwise, you may put a face-up exiled card they own into their graveyard.",
        ],
        [
            "a reveal no pick follows: Thought Distortion",
            "Sorcery",
            "Target opponent reveals their hand. Exile all noncreature, nonland cards from that player's hand and graveyard.",
        ],
        [
            "a pick with no route",
            "Sorcery",
            "Target opponent reveals their hand. You choose a nonland card from it.",
        ],
        [
            "a route with no reveal",
            "Sorcery",
            "You choose a nonland card from it. That player discards that card.",
        ],
        [
            "an exile until this leaves, from a hand: Brain Maggot",
            "Enchantment Creature — Insect",
            "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card until this creature leaves the battlefield.",
        ],
        [
            "an optional discard gating an effect: Formidable Speaker",
            "Creature — Elf Druid",
            "When this creature enters, you may discard a card. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle.",
        ],
        [
            "an optional hand exile gating nothing",
            "Land",
            "At the beginning of your upkeep, you may exile a card from your hand.",
        ],
        [
            "the controller's discard gating a seek: Anguished Recollection",
            "Sorcery",
            "Discard a card. If you do, seek two cards that don't share a card type with the discarded card.",
        ],
    ];
    it.each(refused)("refuses %s", (_label, typeLine, oracleText) => {
        const creature = typeLine.includes("Creature");
        const outcome = compileCard(
            oracleCard({
                typeLine,
                oracleText,
                power: creature ? "1" : undefined,
                toughness: creature ? "1" : undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
