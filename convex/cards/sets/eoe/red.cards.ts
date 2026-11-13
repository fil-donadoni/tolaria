// EOE — red cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Weapons Manufacturing — {1}{R} Enchantment (EOE, issue #8646).
// "Whenever a nontoken artifact you control enters" — `scope: "yours"` over an
// artifact filter with `isToken: false` (CR 111.1: a token is not a card; the
// Munitions token itself never retriggers this). The created Munitions token
// carries its OWN triggered ability (CR 111.3), a self-scoped
// leaves-the-battlefield trigger (CR 603.6c) targeting any target (CR 603.3d);
// "it" is the token, so the damage source is the token (CR 603.10a last known
// information when it has already left).
// hand-tail: Whenever a nontoken artifact you control enters, create a colorless artifact token named Munitions with "When this token leaves the battlefield, it deals 2 damage to any target." (#8646)
export const weaponsManufacturing = defineCard(() => ({
    id: "a058f1a6-318c-4bba-981e-ace079ada806",
    rarity: "rare",
    name: "Weapons Manufacturing",
    oracleText:
        'Whenever a nontoken artifact you control enters, create a colorless artifact token named Munitions with "When this token leaves the battlefield, it deals 2 damage to any target."',
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "weapons-manufacturing-munitions",
            oracleText:
                'Whenever a nontoken artifact you control enters, create a colorless artifact token named Munitions with "When this token leaves the battlefield, it deals 2 damage to any target."',
            scope: "yours",
            filter: { types: "Artifact", isToken: false },
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Munitions",
                        types: ["Artifact"],
                        triggeredAbilities: [
                            {
                                id: "munitions-leaves-damage",
                                oracleText:
                                    "When this token leaves the battlefield, it deals 2 damage to any target.",
                                event: "PERMANENT_LEFT",
                                targetRequirement: { type: "any", count: 1 },
                                effects: [
                                    {
                                        op: "dealDamage",
                                        amount: 2,
                                        to: { target: 0 },
                                    },
                                ],
                            },
                        ],
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
}));
