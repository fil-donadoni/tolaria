// MH1 (Modern Horizons) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as mh1 from "./sets/mh1/index.cards"` re-exports this module.
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { makeTalisman } from "../../abilities";

// Talisman of Creativity / Conviction / Curiosity — {2} artifact mana rocks
// (Vintage Cube free tranche, issue #675, ADR 0041). See `makeTalisman` in
// `convex/cards/abilities/index.ts` for the shared painland-shaped ability.
export const talismanOfCreativity = defineCard(() =>
    makeTalisman({
        id: "4d9dbadd-c1b6-44fe-92ac-6f69d7178342",
        name: "Talisman of Creativity",
        rarity: "uncommon",
        colors: ["U", "R"],
    })
);

export const talismanOfConviction = defineCard(() =>
    makeTalisman({
        id: "71148fd3-0c2c-459e-b8f5-735a0a8dd87f",
        name: "Talisman of Conviction",
        rarity: "uncommon",
        colors: ["R", "W"],
    })
);

export const talismanOfCuriosity = defineCard(() =>
    makeTalisman({
        id: "fd52688a-39fd-430f-b950-cb56e0004396",
        name: "Talisman of Curiosity",
        rarity: "uncommon",
        colors: ["G", "U"],
    })
);

// Prismatic Vista — {T}, Pay 1 life, Sacrifice this land: Search your library
// for a basic land card, put it onto the battlefield, then shuffle. (CR 701.23
// search / 400.7 put onto battlefield / 701.24 shuffle, issue #677.)
// `filter.supertype: "Basic"` restricts the fetch to basic lands; the
// `moveZone` cards-shape moves the picked id to the battlefield untapped.
export const prismaticVista = defineCard(() => ({
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
                    filter: { type: "Land", supertype: "Basic" },
                    // CR 701.23b — a stated quality never compels the find.
                    count: { min: 0, max: 1 },
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
}));
