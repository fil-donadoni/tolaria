// DSC — green cards, split by colour per ADR 0043. The registry's
// `import * as dsc from "./sets/dsc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Ursine Monstrosity — {2}{G} Creature — Bear Mutant, 3/3, trample (CR
// 702.19a). One beginning-of-combat trigger (CR 507), four Ops in Oracle
// order:
//   - `mill` one card (CR 701.17a) — FIRST, so a card type it adds to the
//     graveyard is counted by the pump below.
//   - "choose an opponent at random. This creature attacks that player this
//     combat if able" is `grantAbility`'s `attackRequirement` pinned by
//     `defender: "opponent"` (CR 508.1d, issue #3247): attacking a
//     planeswalker that player controls does not obey it. The engine is
//     two-player, so the random choice among opponents always lands on THE
//     opponent — no random-player selector, no observable difference.
//     `end-of-combat` scopes it to THIS combat, not the turn.
//   - indestructible and the +1/+1-per-card-type pump until end of turn (CR
//     611.2a). The pump's magnitude is a `count` read ONCE, at resolution
//     (CR 608.2h) — a card type that reaches the graveyard later in the turn
//     does not grow it, unlike Barrowgoyf's CDA.
// hand-tail: mill a card and choose an opponent at random (#3247)
export const ursineMonstrosity = defineCard(() => ({
    id: "73cc6df4-3564-4ace-bf8a-eac3e62d725a",
    name: "Ursine Monstrosity",
    rarity: "rare",
    oracleText:
        "Trample\nAt the beginning of combat on your turn, mill a card and choose an opponent at random. This creature attacks that player this combat if able. Until end of turn, this creature gains indestructible and gets +1/+1 for each card type among cards in your graveyard.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear", "Mutant"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ursine-monstrosity-combat",
            oracleText:
                "At the beginning of combat on your turn, mill a card and choose an opponent at random. This creature attacks that player this combat if able. Until end of turn, this creature gains indestructible and gets +1/+1 for each card type among cards in your graveyard.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            effects: [
                { op: "mill", player: "controller", count: 1 },
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    attackRequirement: true,
                    defender: "opponent",
                    duration: { phase: "end-of-combat" },
                },
                {
                    op: "grantAbility",
                    target: { ref: "$source" },
                    ability: "indestructible",
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: {
                        count: {
                            zone: "graveyard",
                            controller: "controller",
                            countTypes: true,
                        },
                    },
                    toughness: {
                        count: {
                            zone: "graveyard",
                            controller: "controller",
                            countTypes: true,
                        },
                    },
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
}));
