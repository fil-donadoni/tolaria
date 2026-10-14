// usg (Urza's Saga) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import { defineCard } from "../../types";

// Gaea's Cradle — "{T}: Add {G} for each creature you control." (CR 605.1a
// mana ability, `useStack: false`.) Board-conditional output via the
// declarative `manaAmountSource` descriptor (CR 107.1, issue #5195): the
// engine adds `manaProduced` once per permanent the filter matches at
// activation time. `manaProduced` is the unit, and the representative
// fallback (one creature) for best-effort callers without a board snapshot.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const gaeasCradle = defineCard(() => ({
    id: "25b0b816-0583-44aa-9dc5-f3ff48993a51",
    rarity: "rare",
    name: "Gaea's Cradle",
    oracleText: "{T}: Add {G} for each creature you control.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "gaeas-cradle-mana",
            oracleText: "{T}: Add {G} for each creature you control.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
            manaAmountSource: {
                filter: { types: ["Creature"], controllerRelation: "you" },
            },
        },
    ],
}));

// Tolarian Academy — "{T}: Add {U} for each artifact you control." (CR
// 605.1a mana ability, `useStack: false`.) Same `manaAmountSource` shape as
// Gaea's Cradle, counting artifacts instead of creatures. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const tolarianAcademy = defineCard(() => ({
    id: "ad7ac9a5-340f-4509-826c-7b9416d47887",
    rarity: "rare",
    name: "Tolarian Academy",
    oracleText: "{T}: Add {U} for each artifact you control.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "tolarian-academy-mana",
            oracleText: "{T}: Add {U} for each artifact you control.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { U: 1 },
            manaAmountSource: {
                filter: { types: ["Artifact"], controllerRelation: "you" },
            },
        },
    ],
}));

// Serra's Sanctum — "{T}: Add {W} for each enchantment you control." (CR
// 605.1a mana ability, `useStack: false`.) Same `manaAmountSource` shape as
// Gaea's Cradle / Tolarian Academy, counting enchantments instead of
// creatures / artifacts. Vintage Cube free tranche (issue #675, ADR 0041).
export const serrasSanctum = defineCard(() => ({
    id: "f7a18130-dbaa-4657-a885-3a96a985935a",
    rarity: "rare",
    name: "Serra's Sanctum",
    oracleText: "{T}: Add {W} for each enchantment you control.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "serras-sanctum-mana",
            oracleText: "{T}: Add {W} for each enchantment you control.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { W: 1 },
            manaAmountSource: {
                filter: { types: ["Enchantment"], controllerRelation: "you" },
            },
        },
    ],
}));
