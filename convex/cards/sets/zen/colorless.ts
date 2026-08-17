// ZEN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as zen from "./sets/zen"` resolves through zen/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Fetchland family (issue #677) — "{T}, Pay 1 life, Sacrifice this land:
// Search your library for a [Subtype] or [Subtype] card, put it onto the
// battlefield, then shuffle." (CR 701.23 search / 400.7 zone change / 701.24
// shuffle). DSL: `choice(zone: "library", filter: { subtype: [A, B] })` — the
// subtype array is an OR (Forest OR Island), mirroring `PermanentFilter`'s
// own array-OR semantics (issue #677) — + `moveZone(cards, from: "library",
// to: "battlefield")` (routes through `putFromLibraryOntoBattlefield`) +
// `libraryLook`(shuffle).

export const mistyRainforest: CardDefinition = {
    id: "24a5cc2c-0fbf-4a5f-b175-6e0ffd0d0787",
    name: "Misty Rainforest",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "misty-rainforest-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Forest", "Island"] },
                    count: 1,
                    prompt: "Search your library for a Forest or Island card.",
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

export const aridMesa: CardDefinition = {
    id: "16c8d2fa-54a7-46e8-980c-905258497c90",
    name: "Arid Mesa",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "arid-mesa-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Mountain", "Plains"] },
                    count: 1,
                    prompt: "Search your library for a Mountain or Plains card.",
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

export const scaldingTarn: CardDefinition = {
    id: "327cf118-cc92-4073-85d0-94d2a0a6989a",
    name: "Scalding Tarn",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "scalding-tarn-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Island", "Mountain"] },
                    count: 1,
                    prompt: "Search your library for an Island or Mountain card.",
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

export const marshFlats: CardDefinition = {
    id: "45026d57-0324-4312-8b86-2e7d4f581ee9",
    name: "Marsh Flats",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Swamp card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "marsh-flats-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Swamp card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Plains", "Swamp"] },
                    count: 1,
                    prompt: "Search your library for a Plains or Swamp card.",
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

export const verdantCatacombs: CardDefinition = {
    id: "7abd2723-2851-4f1a-b2d0-dfcb526472c3",
    name: "Verdant Catacombs",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Forest card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "verdant-catacombs-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Forest card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Swamp", "Forest"] },
                    count: 1,
                    prompt: "Search your library for a Swamp or Forest card.",
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

// Expedition Map — {1} Artifact. "{2}, {T}, Sacrifice this artifact: Search
// your library for a land card, reveal it, put it into your hand, then
// shuffle." The "reveal it" clause is a `reveal` Op on the picked card (issue
// #945, CR 701.20): it makes the found land known to every player, placed
// BEFORE the moveZone/shuffle so the knowledge rides the card into hand.
export const expeditionMap: CardDefinition = {
    id: "c55bee97-593f-441f-b96c-a998d5212a55",
    name: "Expedition Map",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
    oracleText:
        "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
    activatedAbilities: [
        {
            id: "expedition-map-fetch",
            oracleText:
                "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
            cost: { mana: { X: 2 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land" },
                    count: 1,
                    prompt: "Search your library for a land card.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
