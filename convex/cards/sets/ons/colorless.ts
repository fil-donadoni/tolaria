// ONS — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Fetchland family (issue #677) — see zen/colorless.ts's header comment for
// the shared DSL pattern (`choice` with an OR subtype filter + `moveZone`
// cards-shape to the battlefield + `libraryLook` shuffle).

export const pollutedDelta: CardDefinition = {
    id: "0f7585c8-9e21-4eef-afc1-2852de23db2f",
    name: "Polluted Delta",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "polluted-delta-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Island", "Swamp"] },
                    count: 1,
                    prompt: "Search your library for an Island or Swamp card.",
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

export const bloodstainedMire: CardDefinition = {
    id: "68c72226-6f52-4322-8b14-18737293dfa0",
    name: "Bloodstained Mire",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Mountain card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "bloodstained-mire-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Mountain card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Swamp", "Mountain"] },
                    count: 1,
                    prompt: "Search your library for a Swamp or Mountain card.",
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

export const windsweptHeath: CardDefinition = {
    id: "7a7c5941-9c8a-4a40-9efb-a84f05c58e53",
    name: "Windswept Heath",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "windswept-heath-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Forest", "Plains"] },
                    count: 1,
                    prompt: "Search your library for a Forest or Plains card.",
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

export const floodedStrand: CardDefinition = {
    id: "b4e3d844-d3b4-41d8-921d-c1cb3af343f8",
    name: "Flooded Strand",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "flooded-strand-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Plains", "Island"] },
                    count: 1,
                    prompt: "Search your library for a Plains or Island card.",
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

export const woodedFoothills: CardDefinition = {
    id: "cdad38f7-9dfa-4f1b-9fac-41ab2b253f53",
    name: "Wooded Foothills",
    rarity: "rare",
    oracleText:
        "{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "wooded-foothills-fetch",
            oracleText:
                "{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.",
            cost: { tap: true, life: 1, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { subtype: ["Mountain", "Forest"] },
                    count: 1,
                    prompt: "Search your library for a Mountain or Forest card.",
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
