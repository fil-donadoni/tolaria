// Permanent target filters — the seven forms of Grammar Cluster issue #4556.
//
// Two layers:
//
//  1. GOLDEN — a real corpus card's Oracle row compiled whole must produce
//     exactly this Compiled Definition (`sortKeys` equality), one per accepted
//     form.
//  2. REFUSALS — the neighbouring forms the rules must NOT read, so
//     fail-closed is pinned and not assumed.

import { describe, expect, it } from "vitest";
import type { OracleCard } from "../types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const GOLDEN: readonly [string, OracleCard, unknown][] = [
    [
        // CR 608.2c — damage, then the controller's gain.
        "damage and you gain N life",
        {
            name: "Vicious Hunger",
            manaCost: "{B}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Vicious Hunger deals 2 damage to target creature and you gain 2 life.",
            oracleId: "38ea22cd-2c5d-4f66-a111-207aca4c67c3",
            layout: "normal",
        },
        {
            name: "Vicious Hunger",
            types: ["Sorcery"],
            manaCost: { B: 2 },
            oracleText:
                "Vicious Hunger deals 2 damage to target creature and you gain 2 life.",
            effects: [
                { op: "dealDamage", amount: 2, to: { target: 0 } },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    ],
    [
        // CR 404.1 + CR 701.13a — exile a target player's whole graveyard.
        "exile target player's graveyard",
        {
            name: "Tormod's Crypt",
            manaCost: "{0}",
            typeLine: "Artifact",
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            oracleId: "1573f7f9-672c-421a-b1ac-3d0d8aea59ca",
            layout: "normal",
        },
        {
            name: "Tormod's Crypt",
            types: ["Artifact"],
            manaCost: {},
            oracleText:
                "{T}, Sacrifice this artifact: Exile target player's graveyard.",
            activatedAbilities: [
                {
                    id: "tormod-s-crypt-ability",
                    oracleText:
                        "{T}, Sacrifice this artifact: Exile target player's graveyard.",
                    cost: { tap: true, sacrifice: true },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            player: { target: 0 },
                            from: "graveyard",
                            to: "exile",
                        },
                    ],
                    targetRequirement: { type: "player", count: 1 },
                },
            ],
        },
    ],
    [
        // CR 115.1 + CR 701.8a — two announced targets under one verb.
        "destroy target artifact and target enchantment",
        {
            name: "Stomp and Howl",
            manaCost: "{2}{G}",
            typeLine: "Sorcery",
            oracleText: "Destroy target artifact and target enchantment.",
            oracleId: "7cc809ed-5ce1-40d1-896d-014ca8e2b5a6",
            layout: "normal",
        },
        {
            name: "Stomp and Howl",
            types: ["Sorcery"],
            manaCost: { X: 2, G: 1 },
            oracleText: "Destroy target artifact and target enchantment.",
            effects: [
                { op: "destroy", target: { target: 0 } },
                { op: "destroy", target: { target: 1 } },
            ],
            targetRequirement: { type: "Artifact", count: 1 },
            additionalTargetRequirements: [{ type: "Enchantment", count: 1 }],
        },
    ],
    [
        // CR 107.3 — "mana value X" is the X the ability announced.
        "target filter with mana value X",
        {
            name: "Plaguebearer",
            manaCost: "{1}{B}",
            typeLine: "Creature — Zombie",
            oracleText:
                "{X}{X}{B}: Destroy target nonblack creature with mana value X.",
            power: "1",
            toughness: "1",
            oracleId: "f8cc1dc4-740d-4c5b-ac51-7355730a6595",
            layout: "normal",
        },
        {
            name: "Plaguebearer",
            types: ["Creature"],
            subtypes: ["Zombie"],
            manaCost: { X: 1, B: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "{X}{X}{B}: Destroy target nonblack creature with mana value X.",
            activatedAbilities: [
                {
                    id: "plaguebearer-ability",
                    oracleText:
                        "{X}{X}{B}: Destroy target nonblack creature with mana value X.",
                    cost: { mana: { X: "X", xFactor: 2, B: 1 } },
                    useStack: true,
                    effects: [{ op: "destroy", target: { target: 0 } }],
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        excludeColors: ["B"],
                        mvFilter: { equals: "X" },
                    },
                },
            ],
        },
    ],
    [
        // CR 202.3 + CR 702.33e — a bounded destroy, re-bounded when kicked.
        "destroy if its mana value is N or less, kicked instead",
        {
            name: "Overload",
            manaCost: "{R}",
            typeLine: "Instant",
            oracleText:
                "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
            oracleId: "07159efc-c69f-4164-a8ca-9da641dbf702",
            layout: "normal",
        },
        {
            name: "Overload",
            types: ["Instant"],
            manaCost: { R: 1 },
            oracleText:
                "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
            kickers: [
                { id: "kicker", description: "Kicker {2}", mana: { X: 2 } },
            ],
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                left: { manaValue: { of: { target: 0 } } },
                                op: "le",
                                right: 5,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                    else: [
                        {
                            op: "if",
                            predicate: {
                                left: { manaValue: { of: { target: 0 } } },
                                op: "le",
                                right: 2,
                            },
                            then: [{ op: "destroy", target: { target: 0 } }],
                        },
                    ],
                },
            ],
            targetRequirement: { type: "Artifact", count: 1 },
        },
    ],
    [
        // CR 205.2 + CR 105.1 — a comma pair of negated adjectives. The
        // printed card also carries Echo, a separate gap, so the real
        // enters-the-battlefield line is compiled alone.
        "nonartifact, nonblack creature",
        {
            name: "Bone Shredder",
            manaCost: "{2}{B}",
            typeLine: "Creature \u2014 Phyrexian Minion",
            oracleText:
                "When this creature enters, destroy target nonartifact, nonblack creature.",
            power: "1",
            toughness: "1",
            oracleId: "69aa1ac7-17da-4fc9-a3dc-df8a52841f4a",
            layout: "normal",
        },
        {
            name: "Bone Shredder",
            types: ["Creature"],
            subtypes: ["Phyrexian", "Minion"],
            manaCost: { X: 2, B: 1 },
            power: 1,
            toughness: 1,
            oracleText:
                "When this creature enters, destroy target nonartifact, nonblack creature.",
            compiledTriggeredAbilities: [
                {
                    id: "bone-shredder-trigger",
                    oracleText:
                        "When this creature enters, destroy target nonartifact, nonblack creature.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        excludeTypes: ["Artifact"],
                        excludeColors: ["B"],
                    },
                    effects: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        },
    ],
    [
        // CR 400.3 — the controller chooses one of their own permanents.
        "return a blue or black creature you control to its owner's hand",
        {
            name: "Cavern Harpy",
            manaCost: "{U}{B}",
            typeLine: "Creature — Harpy Beast",
            oracleText:
                "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
            power: "2",
            toughness: "1",
            oracleId: "81c40bd8-b989-41e8-9527-eae8fb87311d",
            layout: "normal",
        },
        {
            name: "Cavern Harpy",
            types: ["Creature"],
            subtypes: ["Harpy", "Beast"],
            manaCost: { U: 1, B: 1 },
            power: 2,
            toughness: 1,
            oracleText:
                "Flying\nWhen this creature enters, return a blue or black creature you control to its owner's hand.\nPay 1 life: Return this creature to its owner's hand.",
            staticAbilities: ["flying"],
            activatedAbilities: [
                {
                    id: "cavern-harpy-ability",
                    oracleText:
                        "Pay 1 life: Return this creature to its owner's hand.",
                    cost: { life: 1 },
                    useStack: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
            compiledTriggeredAbilities: [
                {
                    id: "cavern-harpy-trigger",
                    oracleText:
                        "When this creature enters, return a blue or black creature you control to its owner's hand.",
                    head: { kind: "entered", scope: "self" },
                    effects: [
                        {
                            op: "choice",
                            kind: "choose-permanents",
                            player: "controller",
                            zone: "battlefield",
                            filter: { type: "Creature", color: ["U", "B"] },
                            count: 1,
                            prompt: "Return a blue or black creature you control to its owner's hand.",
                            bind: "$bounce1",
                        },
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$bounce1" },
                            effects: [
                                {
                                    op: "moveZone",
                                    target: { ref: "$each" },
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
];

describe("Permanent target filters — golden fixtures", () => {
    it.each(GOLDEN)("%s", (_form, card, expected) => {
        expect(sortKeys(compiledDefinition(card))).toEqual(sortKeys(expected));
    });
});

const refused = (text: string, typeLine = "Creature — Bear") =>
    compileCard(
        oracleCard({
            name: "Refusal Probe",
            manaCost: "{2}{B}",
            typeLine,
            oracleText: text,
            ...(typeLine.startsWith("Creature")
                ? {}
                : { power: undefined, toughness: undefined }),
        })
    ).state;

describe("Permanent target filters — refused neighbours", () => {
    it.each([
        [
            "a gain that is not the controller's",
            "{self} deals 2 damage to target creature and target player gains 2 life.",
            "Sorcery",
        ],
        [
            "a loss after the damage",
            "{self} deals 2 damage to target creature and you lose 2 life.",
            "Sorcery",
        ],
        ["your own graveyard", "Exile your graveyard.", "Sorcery"],
        [
            "an opponent's graveyard without a target",
            "Exile each opponent's graveyard.",
            "Sorcery",
        ],
        [
            "two destroys without the second target",
            "Destroy target artifact and enchantment.",
            "Sorcery",
        ],
        [
            "two destroys under one mana-value bound",
            "Destroy target artifact and target enchantment if its mana value is 2 or less.",
            "Instant",
        ],
        [
            "a mana-value bound on a sweep",
            "Destroy all artifacts if its mana value is 2 or less.",
            "Sorcery",
        ],
        [
            "mana value X as a ceiling",
            "{X}: Destroy target creature with mana value X or less.",
            "Creature — Bear",
        ],
        [
            "mana value X on a spell that announces no X",
            "Destroy target creature with mana value X.",
            "Instant",
        ],
        [
            "mana value X on an ability that announces no X",
            "{T}: Destroy target creature with mana value X.",
            "Artifact",
        ],
        [
            "mana value X on an Aura",
            "Enchant creature with mana value X",
            "Enchantment — Aura",
        ],
        [
            "mana value Y",
            "{X}: Destroy target creature with mana value Y.",
            "Creature — Bear",
        ],
        [
            "a comma between an adjective and a noun",
            "When this creature enters, destroy target nonartifact, creature.",
            "Creature — Bear",
        ],
        [
            "a comma list of three negated adjectives",
            "When this creature enters, destroy target nonartifact, nonblack, nonred creature.",
            "Creature — Bear",
        ],
        [
            "a return that names no controller",
            "When this creature enters, return a blue or black creature to its owner's hand.",
            "Creature — Bear",
        ],
        [
            "a return of an opponent's permanent",
            "When this creature enters, return a creature an opponent controls to its owner's hand.",
            "Creature — Bear",
        ],
        [
            "a return filtered by tap state",
            "When this creature enters, return a tapped creature you control to its owner's hand.",
            "Creature — Bear",
        ],
        [
            "a kicked re-bound naming another type",
            "Kicker {2}\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that creature if its mana value is 5 or less instead.",
            "Instant",
        ],
        [
            "a kicked re-bound of an unbounded destroy",
            "Kicker {2}\nDestroy target artifact. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
            "Instant",
        ],
    ])("refuses %s", (_form, text, typeLine) => {
        expect(refused(text, typeLine)).toBe("unparsed");
    });
});
