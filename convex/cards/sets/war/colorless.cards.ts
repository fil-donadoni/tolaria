// war — colorless cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = the WAR printing).

import { defineCard } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Karn, the Great Creator — {4} Legendary Planeswalker — Karn, starting
// loyalty 5 (CR 306.5b). Issue #10555.
//   • STATIC — "Activated abilities of artifacts your opponents control can't
//     be activated." CR 602.5: a player can't begin to activate an ability
//     that's prohibited from being activated. The battlefield-scanned
//     `activation-restriction` over artifacts whose controller is an opponent
//     of Karn's (`controllerRelation: "opponents"`, the source as `self`).
//     Mana abilities are activated abilities too (CR 605.1a), so they are
//     locked as well; only permanents are covered, so an artifact card's
//     abilities in other zones stay activatable.
//   • +1 — "Until your next turn, up to one target noncreature artifact
//     becomes an artifact creature with power and toughness each equal to its
//     mana value." Up to one target is min 0 (CR 601.2c). `animate` adds the
//     Creature type (CR 205.1b) with a base P/T read off the target's mana
//     value (CR 202.3e — an {X} counts 0 on the battlefield), determined once
//     when the effect is applied (CR 608.2h). "Until your next turn" ends as
//     Karn's controller's next untap step begins (CR 611.2a).
//   • −2 — "You may reveal an artifact card you own from outside the game or
//     choose a face-up artifact card you own in exile. Put that card into your
//     hand." The player picks one of the two sources during resolution
//     (`optionChoice`, CR 608.2d); outside the game is not a zone (CR 400.11),
//     so that branch is `bringFromOutsideGame` (CR 400.11b, the reveal of CR
//     701.20a included). The exile branch picks from Karn's controller's own
//     exile; a face-down exiled card has no characteristics (CR 406.3a), so
//     the artifact filter never matches one. Both picks are optional ("you
//     may").
// hand-tail: Activated abilities of artifacts your opponents control can't be activated. (#10555)
export const karnTheGreatCreator = defineCard(() => ({
    id: "3ec0c0fb-1a4f-45f4-85b7-346a6d3ce2c5",
    name: "Karn, the Great Creator",
    rarity: "rare",
    oracleText:
        "Activated abilities of artifacts your opponents control can't be activated.\n+1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.\n−2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand.",
    manaCost: { X: 4 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Karn"],
    loyalty: 5,
    staticEffects: [
        {
            kind: "activation-restriction",
            id: "karn-the-great-creator-artifact-lock",
            filter: { types: "Artifact", controllerRelation: "opponents" },
            oracleText:
                "Activated abilities of artifacts your opponents control can't be activated.",
        },
    ],
    activatedAbilities: [
        {
            id: "karn-the-great-creator-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.",
            targetRequirement: {
                type: "Artifact",
                excludeTypes: "Creature",
                count: { min: 0, max: 1 },
            },
            effects: [
                {
                    op: "animate",
                    target: { target: 0 },
                    power: { manaValue: { of: { target: 0 } } },
                    toughness: { manaValue: { of: { target: 0 } } },
                    duration: { phase: "untap", player: "controller" },
                },
            ],
        },
        {
            id: "karn-the-great-creator-minus2",
            cost: { loyalty: -2 },
            useStack: true,
            oracleText:
                "−2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand.",
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Put an artifact card into your hand from where?",
                    modes: [
                        {
                            label: "Reveal an artifact card you own from outside the game",
                            effects: [
                                {
                                    op: "bringFromOutsideGame",
                                    player: "controller",
                                    filter: { type: "Artifact" },
                                    prompt: "You may reveal an artifact card you own from outside the game.",
                                },
                            ],
                        },
                        {
                            label: "Choose a face-up artifact card you own in exile",
                            effects: [
                                {
                                    op: "choice",
                                    kind: "choose-exile-card",
                                    player: "controller",
                                    zone: "exile",
                                    filter: { type: "Artifact" },
                                    count: { min: 0, max: 1 },
                                    prompt: "You may choose a face-up artifact card you own in exile.",
                                    bind: "$picked",
                                },
                                {
                                    op: "moveZone",
                                    cards: { ref: "$picked" },
                                    player: "controller",
                                    from: "exile",
                                    to: "hand",
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
}));
