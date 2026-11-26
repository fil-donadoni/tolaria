// The additive gift clause: "If the gift was promised, <effect>" adds its
// effect to the spell's base effect (CR 702.174b, 702.174k); a target inside
// it is chosen only if the gift was promised (CR 702.174m).
//
//  1. GOLDEN fixtures — the six corpus cards the rule graduates, compiled
//     whole and `ready`: the plain clause (one announcing its own target),
//     and the "<subject> also <verb>" clause for each subject it repeats.
//  2. REFUSALS — the neighbours the rule must not read (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const GIFT = "Gift a card\n";

/** A real corpus row and the whole definition the rule compiles it to. */
const GOLDENS: readonly {
    readonly card: {
        readonly name: string;
        readonly manaCost: string;
        readonly typeLine: string;
        readonly oracleText: string;
    };
    readonly expected: unknown;
}[] = [
    {
        card: {
            name: "Consumed by Greed",
            manaCost: "{1}{B}{B}",
            typeLine: "Instant",
            oracleText:
                "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nTarget opponent sacrifices a creature with the greatest power among creatures they control. If the gift was promised, return target creature card from your graveyard to your hand.",
        },
        expected: {
            additionalTargetRequirements: [
                {
                    announcedOnlyIfKicked: true,
                    controller: "you",
                    count: 1,
                    type: "Creature",
                    zone: "graveyard",
                },
            ],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ count: 1, op: "draw", player: "opponent" }],
                },
                {
                    bind: "$sacrifice1",
                    count: 1,
                    filter: { type: "Creature" },
                    kind: "sacrifice-permanents",
                    op: "choice",
                    player: { target: 0 },
                    prompt: "Sacrifice a creature with the greatest power among creatures they control.",
                    superlative: { extreme: "greatest", stat: "power" },
                    zone: "battlefield",
                },
                { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        { op: "moveZone", target: { target: 1 }, to: "hand" },
                    ],
                },
            ],
            kickers: [
                { description: "Gift a card", id: "gift", keyword: "gift" },
            ],
            manaCost: { B: 2, X: 1 },
            name: "Consumed by Greed",
            oracleText:
                "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nTarget opponent sacrifices a creature with the greatest power among creatures they control. If the gift was promised, return target creature card from your graveyard to your hand.",
            targetRequirement: {
                controller: "opponent",
                count: 1,
                type: "player",
            },
            types: ["Instant"],
        },
    },
    {
        card: {
            name: "Sazacap's Brew",
            manaCost: "{1}{R}",
            typeLine: "Instant",
            oracleText:
                "Gift a tapped Fish (You may promise an opponent a gift as you cast this spell. If you do, they create a tapped 1/1 blue Fish creature token before its other effects.)\nAs an additional cost to cast this spell, discard a card.\nTarget player draws two cards. If the gift was promised, target creature you control gets +2/+0 until end of turn.",
        },
        expected: {
            additionalCosts: { discard: { count: 1, filter: {} } },
            additionalTargetRequirements: [
                {
                    announcedOnlyIfKicked: true,
                    controller: "you",
                    count: 1,
                    type: "Creature",
                },
            ],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            controller: "opponent",
                            op: "createToken",
                            token: {
                                colors: ["U"],
                                entersTapped: true,
                                name: "Fish",
                                power: 1,
                                subtypes: ["Fish"],
                                toughness: 1,
                                types: ["Creature"],
                            },
                        },
                    ],
                },
                { count: 2, op: "draw", player: { target: 0 } },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            duration: { phase: "end-of-turn" },
                            op: "pump",
                            power: 2,
                            target: { target: 1 },
                            toughness: 0,
                        },
                    ],
                },
            ],
            kickers: [
                {
                    description: "Gift a tapped Fish",
                    id: "gift",
                    keyword: "gift",
                },
            ],
            manaCost: { R: 1, X: 1 },
            name: "Sazacap's Brew",
            oracleText:
                "Gift a tapped Fish (You may promise an opponent a gift as you cast this spell. If you do, they create a tapped 1/1 blue Fish creature token before its other effects.)\nAs an additional cost to cast this spell, discard a card.\nTarget player draws two cards. If the gift was promised, target creature you control gets +2/+0 until end of turn.",
            targetRequirement: { count: 1, type: "player" },
            types: ["Instant"],
        },
    },
    {
        card: {
            name: "Valley Rally",
            manaCost: "{2}{R}",
            typeLine: "Instant",
            oracleText:
                'Gift a Food (You may promise an opponent a gift as you cast this spell. If you do, they create a Food token before its other effects. It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nCreatures you control get +2/+0 until end of turn. If the gift was promised, target creature you control gains first strike until end of turn.',
        },
        expected: {
            additionalTargetRequirements: [
                {
                    announcedOnlyIfKicked: true,
                    controller: "you",
                    count: 1,
                    type: "Creature",
                },
            ],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            controller: "opponent",
                            op: "createToken",
                            token: {
                                activatedAbilities: [
                                    {
                                        cost: {
                                            mana: { generic: 2 },
                                            sacrifice: true,
                                            tap: true,
                                        },
                                        effects: [
                                            {
                                                amount: 3,
                                                op: "gainLife",
                                                player: "controller",
                                            },
                                        ],
                                        id: "food-token-sacrifice-gain-life",
                                        oracleText:
                                            "{2}, {T}, Sacrifice this token: You gain 3 life.",
                                        useStack: true,
                                    },
                                ],
                                name: "Food",
                                subtypes: ["Food"],
                                types: ["Artifact"],
                            },
                        },
                    ],
                },
                {
                    effects: [
                        {
                            duration: { phase: "end-of-turn" },
                            op: "pump",
                            power: 2,
                            target: { ref: "$each" },
                            toughness: 0,
                        },
                    ],
                    op: "forEach",
                    select: {
                        controller: "controller",
                        filter: { type: "Creature" },
                        set: "permanents",
                        zone: "battlefield",
                    },
                },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            ability: "first strike",
                            duration: { phase: "end-of-turn" },
                            op: "grantAbility",
                            target: { target: 0 },
                        },
                    ],
                },
            ],
            kickers: [
                { description: "Gift a Food", id: "gift", keyword: "gift" },
            ],
            manaCost: { R: 1, X: 2 },
            name: "Valley Rally",
            oracleText:
                'Gift a Food (You may promise an opponent a gift as you cast this spell. If you do, they create a Food token before its other effects. It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nCreatures you control get +2/+0 until end of turn. If the gift was promised, target creature you control gains first strike until end of turn.',
            types: ["Instant"],
        },
    },
    {
        card: {
            name: "Blooming Blast",
            manaCost: "{1}{R}",
            typeLine: "Instant",
            oracleText:
                "Gift a Treasure (You may promise an opponent a gift as you cast this spell. If you do, they create a Treasure token before its other effects. It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")\nBlooming Blast deals 2 damage to target creature. If the gift was promised, Blooming Blast also deals 3 damage to that creature's controller.",
        },
        expected: {
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            controller: "opponent",
                            op: "createToken",
                            token: {
                                activatedAbilities: [
                                    {
                                        cost: { sacrifice: true, tap: true },
                                        id: "treasure-token-mana",
                                        manaChoices: [
                                            { W: 1 },
                                            { U: 1 },
                                            { B: 1 },
                                            { R: 1 },
                                            { G: 1 },
                                        ],
                                        oracleText:
                                            "{T}, Sacrifice this artifact: Add one mana of any color.",
                                        useStack: false,
                                    },
                                ],
                                imagePrintId:
                                    "284ec798-2725-4741-8748-578c259d0623",
                                name: "Treasure",
                                subtypes: ["Treasure"],
                                types: ["Artifact"],
                            },
                        },
                    ],
                },
                { amount: 2, op: "dealDamage", to: { target: 0 } },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            amount: 3,
                            op: "dealDamage",
                            to: { player: { controllerOf: { target: 0 } } },
                        },
                    ],
                },
            ],
            kickers: [
                { description: "Gift a Treasure", id: "gift", keyword: "gift" },
            ],
            manaCost: { R: 1, X: 1 },
            name: "Blooming Blast",
            oracleText:
                "Gift a Treasure (You may promise an opponent a gift as you cast this spell. If you do, they create a Treasure token before its other effects. It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")\nBlooming Blast deals 2 damage to target creature. If the gift was promised, Blooming Blast also deals 3 damage to that creature's controller.",
            targetRequirement: { count: 1, type: "Creature" },
            types: ["Instant"],
        },
    },
    {
        card: {
            name: "Dawn's Truce",
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText:
                "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nYou and permanents you control gain hexproof until end of turn. If the gift was promised, permanents you control also gain indestructible until end of turn.",
        },
        expected: {
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ count: 1, op: "draw", player: "opponent" }],
                },
                {
                    keyword: "hexproof",
                    op: "grantPlayerKeyword",
                    player: "controller",
                },
                {
                    effects: [
                        {
                            ability: "hexproof",
                            duration: { phase: "end-of-turn" },
                            op: "grantAbility",
                            target: { ref: "$each" },
                        },
                    ],
                    op: "forEach",
                    select: {
                        controller: "controller",
                        set: "permanents",
                        zone: "battlefield",
                    },
                },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            effects: [
                                {
                                    ability: "indestructible",
                                    duration: { phase: "end-of-turn" },
                                    op: "grantAbility",
                                    target: { ref: "$each" },
                                },
                            ],
                            op: "forEach",
                            select: {
                                controller: "controller",
                                set: "permanents",
                                zone: "battlefield",
                            },
                        },
                    ],
                },
            ],
            kickers: [
                { description: "Gift a card", id: "gift", keyword: "gift" },
            ],
            manaCost: { W: 1, X: 1 },
            name: "Dawn's Truce",
            oracleText:
                "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nYou and permanents you control gain hexproof until end of turn. If the gift was promised, permanents you control also gain indestructible until end of turn.",
            types: ["Instant"],
        },
    },
    {
        card: {
            name: "Crumb and Get It",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText:
                'Gift a Food (You may promise an opponent a gift as you cast this spell. If you do, they create a Food token before its other effects. It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nTarget creature you control gets +2/+2 until end of turn. If the gift was promised, that creature also gains indestructible until end of turn.',
        },
        expected: {
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            controller: "opponent",
                            op: "createToken",
                            token: {
                                activatedAbilities: [
                                    {
                                        cost: {
                                            mana: { generic: 2 },
                                            sacrifice: true,
                                            tap: true,
                                        },
                                        effects: [
                                            {
                                                amount: 3,
                                                op: "gainLife",
                                                player: "controller",
                                            },
                                        ],
                                        id: "food-token-sacrifice-gain-life",
                                        oracleText:
                                            "{2}, {T}, Sacrifice this token: You gain 3 life.",
                                        useStack: true,
                                    },
                                ],
                                name: "Food",
                                subtypes: ["Food"],
                                types: ["Artifact"],
                            },
                        },
                    ],
                },
                {
                    duration: { phase: "end-of-turn" },
                    op: "pump",
                    power: 2,
                    target: { target: 0 },
                    toughness: 2,
                },
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "gift" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            ability: "indestructible",
                            duration: { phase: "end-of-turn" },
                            op: "grantAbility",
                            target: { target: 0 },
                        },
                    ],
                },
            ],
            kickers: [
                { description: "Gift a Food", id: "gift", keyword: "gift" },
            ],
            manaCost: { W: 1 },
            name: "Crumb and Get It",
            oracleText:
                'Gift a Food (You may promise an opponent a gift as you cast this spell. If you do, they create a Food token before its other effects. It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nTarget creature you control gets +2/+2 until end of turn. If the gift was promised, that creature also gains indestructible until end of turn.',
            targetRequirement: {
                controller: "you",
                count: 1,
                type: "Creature",
            },
            types: ["Instant"],
        },
    },
];

function spell(oracleText: string, typeLine = "Sorcery") {
    return compileCard(
        oracleCard({
            name: "Test Gift Spell",
            manaCost: "{1}{R}",
            typeLine,
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    ).state;
}

describe("Additive gift clause — golden fixtures (CR 702.174b/k/m)", () => {
    it.each(GOLDENS.map((g) => [g.card.name, g] as const))(
        "%s",
        (_name, golden) => {
            const outcome = compileCard(
                oracleCard({
                    ...golden.card,
                    power: undefined,
                    toughness: undefined,
                })
            );
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(golden.expected)
            );
        }
    );
});

describe("Additive gift clause — refusals (fail-closed, ADR 0105 § 2)", () => {
    it.each([
        // A clause reading the promise on a card with no gift.
        "Draw a card. If the gift was promised, draw a card.",
        // A pronoun subject: no gift card prints one, the sentence rule refuses it.
        GIFT +
            "Test Gift Spell deals 2 damage to target creature. If the gift was promised, it deals 2 damage to that creature's controller.",
        // "also" repeating nothing the sentence before acted on.
        GIFT +
            "Draw a card. If the gift was promised, target creature also gains flying until end of turn.",
        // "also" before a verb no gift card prints behind it.
        GIFT +
            "Target creature gets +2/+2 until end of turn. If the gift was promised, that creature also gets +1/+1 until end of turn.",
        // The kicker's "also" is not this rule's.
        "Kicker {U}\nTarget creature you control gets +0/+3 until end of turn. If this spell was kicked, that creature also gains hexproof until end of turn.",
        // The member gaps left refused: each tail is a clause the effect
        // grammar does not read with or without the gate.
        "Gift a tapped Fish\nTarget player draws three cards. If the gift was promised, tap target creature an opponent controls and put a stun counter on it.",
        GIFT +
            "Destroy all creatures. If the gift was promised, return a creature card put into your graveyard this way to the battlefield under your control.",
        GIFT +
            "Target opponent reveals their hand. You choose a nonland card from it. Exile that card. If the gift was promised, you may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it.",
        GIFT +
            "Return target creature card from your graveyard to the battlefield. Then if the gift was promised and that creature isn't legendary, create a token that's a copy of that creature, except it's 1/1.",
    ])("%s", (oracleText) => {
        expect(spell(oracleText)).toBe("unparsed");
    });
});
