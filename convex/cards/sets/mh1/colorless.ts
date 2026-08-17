// MH1 (Modern Horizons) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as mh1 from "./sets/mh1"` resolves through mh1/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { makeTalisman } from "../../abilities";

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
            // CR 602 sacrifice ability, CR 121.1 draw — the controller draws
            // one card on resolution.
            effects: [{ op: "draw", player: "controller", count: 1 }],
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
            // CR 602 sacrifice ability, CR 121.1 draw — the controller draws
            // one card on resolution.
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Talisman of Creativity / Conviction / Curiosity — {2} artifact mana rocks
// (Vintage Cube free tranche, issue #675, ADR 0041). See `makeTalisman` in
// `convex/cards/abilities/index.ts` for the shared painland-shaped ability.
export const talismanOfCreativity: CardDefinition = makeTalisman({
    id: "4d9dbadd-c1b6-44fe-92ac-6f69d7178342",
    name: "Talisman of Creativity",
    rarity: "uncommon",
    colors: ["U", "R"],
});

export const talismanOfConviction: CardDefinition = makeTalisman({
    id: "71148fd3-0c2c-459e-b8f5-735a0a8dd87f",
    name: "Talisman of Conviction",
    rarity: "uncommon",
    colors: ["R", "W"],
});

export const talismanOfCuriosity: CardDefinition = makeTalisman({
    id: "fd52688a-39fd-430f-b950-cb56e0004396",
    name: "Talisman of Curiosity",
    rarity: "uncommon",
    colors: ["G", "U"],
});

// Prismatic Vista — {T}, Pay 1 life, Sacrifice this land: Search your library
// for a basic land card, put it onto the battlefield, then shuffle. (CR 701.23
// search / 400.7 put onto battlefield / 701.24 shuffle, issue #677.)
// `filter.supertype: "Basic"` restricts the fetch to basic lands; the
// `moveZone` cards-shape moves the picked id to the battlefield untapped.
export const prismaticVista: CardDefinition = {
    id: "e37da81e-be12-45a2-9128-376f1ad7b3e8",
    name: "Prismatic Vista",
    rarity: "rare",
    types: ["Land"],
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield, then shuffle.",
    activatedAbilities: [
        {
            id: "prismatic-vista-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { supertype: "Basic" },
                    count: 1,
                    prompt: "Search your library for a basic land card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
