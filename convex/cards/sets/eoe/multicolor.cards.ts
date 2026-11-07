// EOE — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Pinnacle Emissary — {1}{U}{R} Artifact Creature — Robot, 3/3 (EOE, issue
// #8652). The Drone's quoted restriction is the data form Brazen Borrower
// declares (CR 509.1b), carried as a token static key so it survives the
// content-derived token id. "Warp {U/R}" is CR 702.185a's cost with a hybrid
// pip, payable with either colour (CR 107.4e).
// hand-tail: "Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."" (#8652)
export const pinnacleEmissary = defineCard(() => ({
    id: "3c922347-f05f-40a4-bbee-6bc02a1e0de5",
    rarity: "rare",
    name: "Pinnacle Emissary",
    oracleText:
        'Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."\nWarp {U/R} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)',
    manaCost: { X: 1, U: 1, R: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Robot"],
    power: 3,
    toughness: 3,
    staticAbilities: ["warp"],
    warp: {
        id: "warp",
        description: "Warp {U/R}",
        mana: { hybrid: [["U", "R"]] },
    },
    triggeredAbilities: [
        spellCastTrigger({
            id: "pinnacle-emissary-artifact-cast-drone",
            oracleText:
                'Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."',
            scope: "you",
            filter: { types: "Artifact" },
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Drone",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Drone"],
                        power: 1,
                        toughness: 1,
                        staticAbilities: ["flying"],
                        staticEffectKeys: ["can-block-only-flying-self"],
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
}));
