// MH1 (Modern Horizons) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as mh1 from "./sets/mh1"` resolves through mh1/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";

// The Modern Horizons "Horizon land" cycle — a painland mana ability
// ({T}, Pay 1 life: Add one of two colours) plus a cantrip-sacrifice ability
// ({1}, {T}, Sacrifice this land: Draw a card). CR 605.1a mana ability
// (useStack: false), CR 118.4 life payment in the cost, CR 602 sacrifice
// ability that uses the stack. Composed from existing primitives — the mana
// ability mirrors Standing Stones (DRK).

// Waterlogged Grove — {G}/{U} painland.
export const waterloggedGrove: CardDefinition = {
    id: "0ab6bfbd-d2e1-4c4c-9f91-6f69c5b8e3bb",
    rarity: "rare",
    name: "Waterlogged Grove",
    oracleText:
        "{T}, Pay 1 life: Add {G} or {U}.\n{1}, {T}, Sacrifice this land: Draw a card.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "waterlogged-grove-mana",
            oracleText: "{T}, Pay 1 life: Add {G} or {U}.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ G: 1 }, { U: 1 }],
        },
        {
            id: "waterlogged-grove-draw",
            oracleText: "{1}, {T}, Sacrifice this land: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// Sunbaked Canyon — {R}/{W} painland.
export const sunbakedCanyon: CardDefinition = {
    id: "c36820fa-ee86-4206-9a0d-737a67cf5208",
    rarity: "rare",
    name: "Sunbaked Canyon",
    oracleText:
        "{T}, Pay 1 life: Add {R} or {W}.\n{1}, {T}, Sacrifice this land: Draw a card.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "sunbaked-canyon-mana",
            oracleText: "{T}, Pay 1 life: Add {R} or {W}.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaChoices: [{ R: 1 }, { W: 1 }],
        },
        {
            id: "sunbaked-canyon-draw",
            oracleText: "{1}, {T}, Sacrifice this land: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};
