// ody — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

const SQUIRREL_NEST_ID = "22eccb27-1723-4c5a-96b8-85e6e5739c30";

// Squirrel Nest — {1}{G}{G} Enchantment — Aura. "Enchant land. Enchanted land
// has '{T}: Create a 1/1 green Squirrel creature token.'" The Forbidden Lore /
// Earthlore shape (ice/green.ts): an Aura on any land whose whole effect is an
// `activated-grant` StaticEffect (CR 611.1b / 613.1f) pushing ONE activated
// ability onto the enchanted land. `AURA_AFFECTS_HOST` scopes the grant to the
// land this Aura is attached to; the template lives on `grantTemplates[]` so
// Squirrel Nest itself exposes nothing. The cost is the LAND's own tap
// (`cost.tap`, CR 602.1) and the effect is the spec-driven `createToken` Op
// (CR 111 / 701.7) — the 1/1 green Squirrel spec Deep Forest Hermit already
// uses (nem/green.ts). "Enchant land" carries no controller clause, so it may
// sit on an opponent's land (that land's controller activates).
export const squirrelNest: CardDefinition = {
    id: SQUIRREL_NEST_ID,
    name: "Squirrel Nest",
    rarity: "uncommon",
    oracleText:
        'Enchant land\nEnchanted land has "{T}: Create a 1/1 green Squirrel creature token."',
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "squirrel-nest-make-squirrel",
        },
    ],
    grantTemplates: [
        {
            id: "squirrel-nest-make-squirrel",
            oracleText: "{T}: Create a 1/1 green Squirrel creature token.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Squirrel",
                        types: ["Creature"],
                        subtypes: ["Squirrel"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        imagePrintId: tokenPrintIdFor(
                            SQUIRREL_NEST_ID,
                            "Squirrel"
                        ),
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
    ],
};
