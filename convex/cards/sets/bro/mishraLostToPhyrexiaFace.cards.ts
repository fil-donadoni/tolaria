// bro — Mishra, Lost to Phyrexia: the combined back face of the meld pair
// Phyrexian Dragon Engine + Mishra, Claimed by Gix (CR 712.4a). Declared here
// because BOTH halves declare it and CR 701.42b reads the two declarations
// against each other; each half registers it as its own `#meld` twin (ADR 0161).
//
// Art: the FRONT image of the print `imagePrintId` names, because Scryfall
// publishes a combined back face as a card of its own (`cards/meld.ts`).

import type { CardBackFace } from "../../types";
import { POWERSTONE_TOKEN } from "../../sharedTokens";

const MISHRA_LOST_TO_PHYREXIA_TRIGGER_TEXT =
    "Whenever Mishra enters or attacks, choose three —\n• Target opponent discards two cards.\n• Mishra deals 3 damage to any target.\n• Destroy target artifact or planeswalker.\n• Creatures you control gain menace and trample until end of turn.\n• Creatures you don't control get -1/-1 until end of turn.\n• Create two tapped Powerstone tokens.";

export const mishraLostToPhyrexiaFace: CardBackFace = {
    kind: "meld",
    name: "Mishra, Lost to Phyrexia",
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Artificer"],
    supertypes: ["Legendary"],
    power: 9,
    toughness: 9,
    imagePrintId: "0220c1e9-07bc-44f0-b39e-ca345ec4ea28",
    triggeredAbilities: [
        {
            id: "mishra-lost-to-phyrexia-trigger",
            oracleText: MISHRA_LOST_TO_PHYREXIA_TRIGGER_TEXT,
            event: ["PERMANENT_ENTERED", "ATTACKERS_DECLARED"],
            matches: (event, self) =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)),
            modeSelection: { min: 3, max: 3 },
            modes: [
                {
                    id: "discard-two",
                    label: "Target opponent discards two cards",
                    oracleText: "Target opponent discards two cards.",
                    targetRequirement: { type: "player", count: 1 },
                    effects: [
                        {
                            op: "choice",
                            kind: "discard-hand",
                            player: { target: 0 },
                            zone: "hand",
                            count: 2,
                            prompt: "Discard two cards.",
                            bind: "$discarded",
                        },
                        {
                            op: "discard",
                            player: { target: 0 },
                            cards: { ref: "$discarded" },
                        },
                    ],
                },
                {
                    id: "three-damage",
                    label: "Mishra deals 3 damage to any target",
                    oracleText: "Mishra deals 3 damage to any target.",
                    targetRequirement: { type: "any", count: 1 },
                    effects: [
                        { op: "dealDamage", target: { target: 0 }, amount: 3 },
                    ],
                },
                {
                    id: "destroy",
                    label: "Destroy target artifact or planeswalker",
                    oracleText: "Destroy target artifact or planeswalker.",
                    targetRequirement: {
                        type: ["Artifact", "Planeswalker"],
                        count: 1,
                    },
                    effects: [{ op: "destroy", target: { target: 0 } }],
                },
                {
                    id: "menace-trample",
                    label: "Creatures you control gain menace and trample",
                    oracleText:
                        "Creatures you control gain menace and trample until end of turn.",
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature" },
                            },
                            effects: ["menace", "trample"].map((ability) => ({
                                op: "grantAbility" as const,
                                ability,
                                target: { ref: "$each" },
                                duration: { phase: "end-of-turn" as const },
                            })),
                        },
                    ],
                },
                {
                    id: "minus-one",
                    label: "Creatures you don't control get -1/-1",
                    oracleText:
                        "Creatures you don't control get -1/-1 until end of turn.",
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "opponent",
                                filter: { type: "Creature" },
                            },
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$each" },
                                    power: -1,
                                    toughness: -1,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "powerstones",
                    label: "Create two tapped Powerstone tokens",
                    oracleText: "Create two tapped Powerstone tokens.",
                    effects: [
                        {
                            op: "createToken",
                            token: { ...POWERSTONE_TOKEN, entersTapped: true },
                            controller: "controller",
                            count: 2,
                        },
                    ],
                },
            ],
        },
    ],
};
