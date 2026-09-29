// jou (Journey into Nyx) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";

// Mana Confluence — "{T}, Pay 1 life: Add one mana of any color." (CR 605.1a
// mana ability, `useStack: false`, CR 119.4 life payment cost.) The any-color
// choice follows the established Birds of Paradise / Talisman shape.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const manaConfluence: CardDefinition = {
    id: "504a69eb-3c2d-4bb1-b117-252b15acf0c2",
    rarity: "rare",
    name: "Mana Confluence",
    oracleText: "{T}, Pay 1 life: Add one mana of any color.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mana-confluence-mana",
            oracleText: "{T}, Pay 1 life: Add one mana of any color.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
