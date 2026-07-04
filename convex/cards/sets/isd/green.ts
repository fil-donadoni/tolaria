// isd (Innistrad) — green cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Cards are classified by the colour
// identity of their mana cost (CR 202.2).

import type { CardDefinition } from "../../types";
import { makeTapForMana } from "../../abilities";

// Avacyn's Pilgrim — one-mana dork that fixes into white (CR 605.1a mana
// ability, `useStack: false`); same shape as Llanowar Elves/Elvish Mystic but
// producing a color other than its own casting cost. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const avacynsPilgrim: CardDefinition = {
    id: "7eb39e97-53c2-4df0-9fb3-a3d6a24ec41f",
    rarity: "common",
    name: "Avacyn's Pilgrim",
    oracleText: "{T}: Add {W}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        makeTapForMana({
            id: "avacyns-pilgrim-mana",
            oracleText: "{T}: Add {W}.",
            produces: { W: 1 },
        }),
    ],
};
