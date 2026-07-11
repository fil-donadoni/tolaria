// usg (Urza's Saga) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    PermanentView,
} from "../../types";

// Gaea's Cradle — "{T}: Add {G} for each creature you control." (CR 605.1a
// mana ability, `useStack: false`.) Board-conditional output via the
// `manaAmount` hook — the same primitive the Urza land trio uses
// (`convex/cards/sets/atq/colorless.ts`), generalized here to a COUNT rather
// than a binary on/off. `manaProduced` is the representative fallback (one
// creature) for best-effort callers without a board snapshot. Vintage Cube
// free tranche (issue #675, ADR 0041).
export const gaeasCradle: CardDefinition = {
    id: "25b0b816-0583-44aa-9dc5-f3ff48993a51",
    rarity: "rare",
    name: "Gaea's Cradle",
    oracleText: "{T}: Add {G} for each creature you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "gaeas-cradle-mana",
            oracleText: "{T}: Add {G} for each creature you control.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ G: 1 });
            },
            manaProduced: { G: 1 },
            manaAmount: (_source, battlefield) => ({
                G: battlefield.filter((p: PermanentView) =>
                    p.types.includes("Creature")
                ).length,
            }),
        },
    ],
};

// Tolarian Academy — "{T}: Add {U} for each artifact you control." (CR
// 605.1a mana ability, `useStack: false`.) Same `manaAmount` shape as
// Gaea's Cradle, counting artifacts instead of creatures. Vintage Cube free
// tranche (issue #675, ADR 0041).
export const tolarianAcademy: CardDefinition = {
    id: "ad7ac9a5-340f-4509-826c-7b9416d47887",
    rarity: "rare",
    name: "Tolarian Academy",
    oracleText: "{T}: Add {U} for each artifact you control.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "tolarian-academy-mana",
            oracleText: "{T}: Add {U} for each artifact you control.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ U: 1 });
            },
            manaProduced: { U: 1 },
            manaAmount: (_source, battlefield) => ({
                U: battlefield.filter((p: PermanentView) =>
                    p.types.includes("Artifact")
                ).length,
            }),
        },
    ],
};

// Serra's Sanctum — "{T}: Add {W} for each enchantment you control." (CR
// 605.1a mana ability, `useStack: false`.) Same `manaAmount` shape as Gaea's
// Cradle / Tolarian Academy, counting enchantments instead of creatures /
// artifacts. Vintage Cube free tranche (issue #675, ADR 0041).
export const serrasSanctum: CardDefinition = {
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
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            manaProduced: { W: 1 },
            manaAmount: (_source, battlefield) => ({
                W: battlefield.filter((p: PermanentView) =>
                    p.types.includes("Enchantment")
                ).length,
            }),
        },
    ],
};
