// MSH — white cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, PERMANENT_TYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Night Nurse, Healer of Heroes — {1}{W} Legendary Creature — Human Doctor
// Hero, 2/1. "Flash, lifelink. When Night Nurse enters, choose target
// permanent card in your graveyard that was put there from anywhere this
// turn. Return it to your hand." (CR 702.8 flash, CR 702.15 lifelink, CR
// 603.6a ETB, CR 115.1 target.) "Permanent card" = the six permanent card
// types (CR 110.4a via `PERMANENT_TYPES`); `zone: "graveyard"` +
// `controller: "you"` = "in YOUR graveyard"; `putIntoGraveyardThisTurn` is the
// per-card stamp filter (issue #7209, CR 400.7) written on every path into a
// graveyard. The trigger is a real target (CR 115.1), so the card is
// re-checked on resolution (CR 608.2b) and a stamp-less card fizzles it.
//
// hand-tail: Choose target permanent card in your graveyard that was put there from anywhere this turn (#7242)
export const nightNurseHealerOfHeroes = defineCard(() => ({
    id: "3199907b-9f24-4554-942a-8ab5a7701717",
    rarity: "uncommon",
    name: "Night Nurse, Healer of Heroes",
    oracleText:
        "Flash\nLifelink\nWhen Night Nurse enters, choose target permanent card in your graveyard that was put there from anywhere this turn. Return it to your hand.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Doctor", "Hero"],
    power: 2,
    toughness: 1,
    staticAbilities: ["flash", "lifelink"],
    triggeredAbilities: [
        enteredTrigger({
            id: "night-nurse-etb",
            oracleText:
                "When Night Nurse enters, choose target permanent card in your graveyard that was put there from anywhere this turn. Return it to your hand.",
            scope: "self",
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                zone: "graveyard",
                controller: "you",
                putIntoGraveyardThisTurn: true,
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        }),
    ],
}));
