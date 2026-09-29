// m14 (Magic 2014) — green cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Cards are classified by the colour
// identity of their mana cost (CR 202.2).

import type { CardDefinition } from "../../types";
import { makeTapForMana } from "../../abilities";

// Elvish Mystic — vanilla one-mana dork, identical shape to Llanowar Elves
// (CR 605.1a mana ability, `useStack: false`). Vintage Cube free tranche
// (issue #675, ADR 0041).
export const elvishMystic: CardDefinition = {
    id: "60d0e6a6-629a-45a7-bfcb-25ba7156788b",
    rarity: "common",
    name: "Elvish Mystic",
    oracleText: "{T}: Add {G}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "elvish-mystic-mana",
            oracleText: "{T}: Add {G}.",
            produces: { G: 1 },
        }),
    ],
};
