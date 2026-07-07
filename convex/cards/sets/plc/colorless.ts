// plc (Planar Chaos) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// Urborg, Tomb of Yawgmoth — "Each land is a Swamp in addition to its other
// land types." (CR 305.7, 611 — layer 4 subtype addition.) Modelled as a
// `subtype-add` static effect (issue #675, ADR 0041): the additive sibling of
// the shipped `subtype-set` kind — Urborg must ADD Swamp to every land
// (a Tropical Island stays Island Forest AND becomes Island Forest Swamp),
// never REPLACE its printed types the way `subtype-set` does. `applies`
// matches every land on every battlefield (no controller restriction — the
// Oracle text says "Each land", not "Lands you control"). No explicit
// `activatedAbilities` needed: Urborg is itself a Land, so its own effect adds
// "Swamp" to its own live `subtypes`.
//
// The {T}: Add {B} comes from the engine's unified mana-tap options
// (`getManaTapOptionsDetailed`, CR 605.1a / 305.6): the Swamp subtype grants an
// intrinsic {T}: Add {B} that STACKS with the land's other basic-type options
// and its own activated mana ability, as a SEPARATE choice. A Mountain under
// Urborg taps for {R} OR {B}; City of Traitors keeps {C}{C} AND gains {B}; a
// dual land offers all three. (The original impl relied on the single-colour
// `getBasicLandMana`, which collapsed multi-type lands to their first subtype
// and let the intrinsic ability shadow a land's own — fixed by the unified
// option list. Its per-card test only covered Urborg-on-itself, a pure Swamp,
// the one case where single-colour happened to be correct.)
export const urborgTombOfYawgmoth: CardDefinition = {
    id: "19e1224f-82cb-4f41-8739-f880cba61bbb",
    rarity: "rare",
    name: "Urborg, Tomb of Yawgmoth",
    oracleText: "Each land is a Swamp in addition to its other land types.",
    manaCost: {},
    supertypes: ["Legendary"],
    types: ["Land"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: (target) => target.types.includes("Land"),
            subtypes: ["Swamp"],
        },
    ],
};
