// DSC — black cards, split by colour per ADR 0043. The registry's
// `import * as dsc from "./sets/dsc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Metamorphosis Fanatic — {4}{B}{B} Creature — Human Cleric 4/4.
// "Lifelink
//  When this creature enters, return up to one target creature card from your
//  graveyard to the battlefield with a lifelink counter on it.
//  Miracle {1}{B}"
//
// CR 122.1b — the lifelink counter grants the returned creature lifelink
// through the keyword-counter grant (`getKeywordCounterGrant`); it is placed
// AS the creature enters (`entersWithCounters`, CR 614.1c), never after.
// CR 702.94a — Miracle is the `miracle` cost; the reveal window and the
// linked cast trigger are the keyword's (`gre/miracle.ts`).
//
// hand-tail: "When this creature enters, return up to one target creature card from your graveyard to the battlefield with a lifelink counter on it." (#7239)
export const metamorphosisFanatic = defineCard(() => ({
    id: "16448d95-ee21-4def-b880-26f6f159c213",
    name: "Metamorphosis Fanatic",
    rarity: "rare",
    oracleText:
        "Lifelink\nWhen this creature enters, return up to one target creature card from your graveyard to the battlefield with a lifelink counter on it.\nMiracle {1}{B} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)",
    manaCost: { X: 4, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 4,
    toughness: 4,
    staticAbilities: ["lifelink"],
    miracle: { X: 1, B: 1 },
    triggeredAbilities: [
        enteredTrigger({
            id: "metamorphosis-fanatic-etb",
            oracleText:
                "When this creature enters, return up to one target creature card from your graveyard to the battlefield with a lifelink counter on it.",
            scope: "self",
            // CR 603.3d / 601.2c — "up to one target": chosen as the trigger
            // goes on the stack, zero allowed.
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "battlefield",
                    entersWithCounters: { lifelink: 1 },
                },
            ],
        }),
    ],
}));
