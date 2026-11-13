// MOR — green cards, split by colour per ADR 0043. The registry's
// `import * as mor from "./sets/mor/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Scapeshift — {2}{G}{G} Sorcery (MOR, issue #8632, modern-metagame).
// "Sacrifice any number of lands. Search your library for up to that many land
// cards, put them onto the battlefield tapped, then shuffle."
//   - "Any number" is a `choice` over the controller's own lands with a
//     `{ min: 0, max }` range clamped to what exists; the picks are
//     sacrificed as a resolution-time effect, not a cost (CR 701.21a).
//   - "That many" is the SIZE of the sacrificed picks (`setSize`, the Myr
//     Battlesphere shape): the search ceiling is computed when the choice is
//     raised, once the lands are gone (the search, CR 701.23a), and "up to" with a stated
//     quality never compels the find (CR 701.23b, `min: 0`).
//   - The found lands enter tapped (`tapped: true`), then the library is
//     shuffled (CR 701.24a). Zero lands raises no search and the shuffle
//     still happens.
// hand-tail: Sacrifice any number of lands. Search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle. (#8632)
export const scapeshift = defineCard(() => ({
    id: "84829605-50eb-455d-a236-ebfa11e883c5",
    name: "Scapeshift",
    rarity: "rare",
    oracleText:
        "Sacrifice any number of lands. Search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.",
    manaCost: { X: 2, G: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            filter: { type: "Land" },
            count: { min: 0, max: Number.MAX_SAFE_INTEGER },
            prompt: "Sacrifice any number of lands.",
            bind: "$sacrificed",
        },
        { op: "sacrifice", permanents: { ref: "$sacrificed" } },
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Land" },
            count: { min: 0, max: { setSize: { of: { ref: "$sacrificed" } } } },
            prompt: "Search your library for up to that many land cards.",
            bind: "$found",
        },
        {
            op: "moveZone",
            cards: { ref: "$found" },
            player: "controller",
            from: "library",
            to: "battlefield",
            tapped: true,
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
}));
