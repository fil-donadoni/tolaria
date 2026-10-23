// SPM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as spm from "./sets/spm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, BASIC_LAND_SUBTYPES } from "../../types";

// Multiversal Passage — "As this land enters, choose a basic land type. Then
// you may pay 2 life. If you don't, it enters tapped.\nThis land is the
// chosen type." (issue #1306, parent PRD #620; issue #2672.) Composes three
// EXISTING land-entry mechanisms — no new capability:
//  - the type pick is a static ability, not a trigger, and a replacement
//    whose choice is made BEFORE the land enters:
//    CR 603.6d / CR 614.1c / CR 614.12a — declared as the ADR 0100 as-enters
//    `subtypes` choice and stored on `CardInstanceState.chosenSubtypes`
//    (Illusionary Terrain's seam, `ice/blue.cards.ts`);
//  - the pay-choice, `entersTappedUnlessPay: { life: 2 }`, the shock-land
//    shape (Steam Vents, `gpt/colorless.cards.ts`) — raised AFTER the type
//    pick, both before the land is on the battlefield, on every play origin
//    and on an effect entry (`parkPlayedLandOnAsEnters`, `gre/playLand.ts`);
//  - CR 305.7 layer-4 subtype replacement, `subtype-set` with the
//    computed-output `subtypesFor` form targeting the SOURCE itself — "This
//    land is the chosen type" grants only the subtype, never the Basic
//    supertype, mirroring Phantasmal Terrain's "Enchanted land is the chosen
//    type", `lea/blue.cards.ts`. Once the subtype is set, the land's `{T}: Add
//    [colour]` mana ability is INTRINSIC (`getBasicLandMana` reads
//    live/effective subtypes) — no `activatedAbilities` needed.
export const multiversalPassage = defineCard(() => ({
    id: "f5fb426a-5618-4dd4-9c51-0cc847be8c1d",
    name: "Multiversal Passage",
    rarity: "rare",
    oracleText:
        "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped.\nThis land is the chosen type.",
    types: ["Land"],
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...BASIC_LAND_SUBTYPES], count: 1 },
        ],
    },
    entersTappedUnlessPay: { life: 2 },
    staticEffects: [
        {
            kind: "subtype-set",
            subtypesFor: (target, source) => {
                if (target.id !== source.id) return null;
                const chosen = source.chosenSubtypes?.[0];
                return chosen ? [chosen] : null;
            },
        },
    ],
}));
