// ZNR — red cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Valakut Awakening // Valakut Stoneforge — {2}{R} Instant // Land (ZNR, issue
// #8642, modern-metagame). "Put any number of cards from your hand on the
// bottom of your library, then draw that many cards plus one." Back face: "This
// land enters tapped. {T}: Add {R}."
//   - CR 712.12 / 712.3 — a modal DFC: the front is the instant, the back a
//     land that is only ever played (`kind: "modal"`, no manaCost).
//   - CR 614.1d — "enters tapped" is `CardBackFace.entersTapped`.
//   - "Any number" is a `choose-hand-card` with `{ min: 0, max }` clamped to
//     the hand; zero is a legal pick and still draws the one card.
//   - CR 401.3 / 400.7 — `moveZone` hand → library appends, i.e. the BOTTOM;
//     "that many cards plus one" is the picks' `setSize` draw followed by a
//     one-card draw (CR 121.2: cards are drawn one at a time, so the two draws
//     are the same total).
//
// hand-tail: Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one. (#8642)
export const valakutAwakeningValakutStoneforge = defineCard(() => ({
    id: "a156b510-8879-4a7b-b15b-71374cb1e6f7",
    name: "Valakut Awakening",
    rarity: "rare",
    oracleText:
        "Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: { min: 0, max: Number.MAX_SAFE_INTEGER },
            prompt: "Put any number of cards from your hand on the bottom of your library.",
            bind: "$bottomed",
        },
        {
            op: "moveZone",
            cards: { ref: "$bottomed" },
            player: "controller",
            from: "hand",
            to: "library",
        },
        {
            op: "draw",
            player: "controller",
            count: { setSize: { of: { ref: "$bottomed" } } },
        },
        { op: "draw", player: "controller", count: 1 },
    ],
    backFace: {
        kind: "modal",
        name: "Valakut Stoneforge",
        types: ["Land"],
        activatedAbilities: [
            {
                id: "valakut-stoneforge-mana",
                oracleText: "{T}: Add {R}.",
                cost: { tap: true },
                useStack: false,
                manaProduced: { R: 1 },
            },
        ],
        entersTapped: true,
        oracleText: "This land enters tapped.\n{T}: Add {R}.",
    },
}));
