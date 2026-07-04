// ths (Theros) — green cards (ADR 0043 colour split). Modern Scryfall oracle
// text is authoritative (ADR 0004). Cards are classified by the colour
// identity of their mana cost (CR 202.2).

import type { ActivatedAbilityContext, CardDefinition } from "../../types";

// Sylvan Caryatid — Defender, hexproof; "{T}: Add one mana of any color."
// (CR 605.1a mana ability, `useStack: false`, CR 702.16 hexproof, CR 702.3
// defender.) The any-color choice follows the established Birds of
// Paradise / Talisman shape: `effect` produces a representative default, the
// `manaChoices` array exposes every option to the picker. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const sylvanCaryatid: CardDefinition = {
    id: "d40b65c1-b24d-492d-81b9-d8474ebdc08c",
    rarity: "rare",
    name: "Sylvan Caryatid",
    oracleText: "Defender, hexproof\n{T}: Add one mana of any color.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant"],
    power: 0,
    toughness: 3,
    staticAbilities: ["defender", "hexproof"],
    activatedAbilities: [
        {
            id: "sylvan-caryatid-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ G: 1 });
            },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
