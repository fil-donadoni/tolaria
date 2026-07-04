// mh2 (Modern Horizons 2) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// Yavimaya, Cradle of Growth — "Each land is a Forest in addition to its
// other land types." (CR 305.7, 611 — layer 4 subtype addition.) Same
// `subtype-add` shape as Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — see that card's comment for the
// full rationale. No explicit `activatedAbilities` needed: Yavimaya's own
// effect adds "Forest" to its own live `subtypes`, and the engine's
// basic-land-type mana inference grants the {T}: Add {G} ability for free.
export const yavimayaCradleOfGrowth: CardDefinition = {
    id: "4e4b6e22-93b2-4896-bba5-0ceaa5d8ea3c",
    rarity: "rare",
    name: "Yavimaya, Cradle of Growth",
    oracleText: "Each land is a Forest in addition to its other land types.",
    manaCost: {},
    supertypes: ["Legendary"],
    types: ["Land"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: (target) => target.types.includes("Land"),
            subtypes: ["Forest"],
        },
    ],
};
