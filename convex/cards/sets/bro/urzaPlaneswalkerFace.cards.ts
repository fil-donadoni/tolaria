// bro — Urza, Planeswalker: the combined back face of the meld pair The
// Mightstone and Weakstone + Urza, Lord Protector (CR 712.4a). Declared here
// because BOTH halves declare it and CR 701.42b reads the two declarations
// against each other; each half registers it as its own `#meld` twin (ADR 0161).
//
// Art: the FRONT image of the print `imagePrintId` names, because Scryfall
// publishes a combined back face as a card of its own (`cards/meld.ts`).

import type { CardBackFace } from "../../types";

export const urzaPlaneswalkerFace: CardBackFace = {
    kind: "meld",
    name: "Urza, Planeswalker",
    types: ["Planeswalker"],
    subtypes: ["Urza"],
    supertypes: ["Legendary"],
    loyalty: 7,
    staticEffectKeys: ["loyalty-activation-twice"],
    activatedAbilities: [
        {
            id: "urza-planeswalker-ability",
            oracleText:
                "+2: Artifact, instant, and sorcery spells you cast this turn cost {2} less to cast. You gain 2 life.",
            cost: {
                loyalty: 2,
            },
            useStack: true,
            effects: [
                {
                    op: "reduceSpellCostThisTurn",
                    player: "controller",
                    amount: {
                        X: 2,
                    },
                    filter: {
                        types: ["Artifact", "Instant", "Sorcery"],
                    },
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: 2,
                },
            ],
        },
        {
            id: "urza-planeswalker-ability-2",
            oracleText: "+1: Draw two cards, then discard a card.",
            cost: {
                loyalty: 1,
            },
            useStack: true,
            effects: [
                {
                    op: "draw",
                    player: "controller",
                    count: 2,
                },
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
                    cards: {
                        ref: "$discard1",
                    },
                },
            ],
        },
        {
            id: "urza-planeswalker-ability-3",
            oracleText:
                "0: Create two 1/1 colorless Soldier artifact creature tokens.",
            cost: {
                loyalty: 0,
            },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Soldier",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Soldier"],
                        power: 1,
                        toughness: 1,
                        colors: [],
                        imagePrintId: "37da5b54-ec55-46e3-9f0b-565cbbe1ac7a",
                    },
                    controller: "controller",
                    count: 2,
                },
            ],
        },
        {
            id: "urza-planeswalker-ability-4",
            oracleText: "-3: Exile target nonland permanent.",
            cost: {
                loyalty: -3,
            },
            useStack: true,
            effects: [
                {
                    op: "exile",
                    target: {
                        target: 0,
                    },
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
                excludeTypes: ["Land"],
            },
        },
        {
            id: "urza-planeswalker-ability-5",
            oracleText:
                "-10: Artifacts and planeswalkers you control gain indestructible until end of turn. Destroy all nonland permanents.",
            cost: {
                loyalty: -10,
            },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: {
                            type: ["Artifact", "Planeswalker"],
                        },
                    },
                    effects: [
                        {
                            op: "grantAbility",
                            target: {
                                ref: "$each",
                            },
                            ability: "indestructible",
                            duration: {
                                phase: "end-of-turn",
                            },
                        },
                    ],
                },
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: {
                            excludeType: "Land",
                        },
                    },
                    effects: [
                        {
                            op: "destroy",
                            target: {
                                ref: "$each",
                            },
                        },
                    ],
                },
            ],
        },
    ],
    oracleText:
        "You may activate the loyalty abilities of Urza twice each turn rather than only once.\n+2: Artifact, instant, and sorcery spells you cast this turn cost {2} less to cast. You gain 2 life.\n+1: Draw two cards, then discard a card.\n0: Create two 1/1 colorless Soldier artifact creature tokens.\n−3: Exile target nonland permanent.\n−10: Artifacts and planeswalkers you control gain indestructible until end of turn. Destroy all nonland permanents.",
    imagePrintId: "40a01679-3224-427e-bd1d-b797b0ab68b7",
    colors: ["W", "U"],
};
