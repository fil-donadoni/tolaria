// APC — green cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Gaea's Balance — the first CATEGORISED SEARCH (issue #3808): "Search your
// library for a land card of each basic land type."
//
// CR 701.23a — to search is to look at every card in the zone and find cards
// matching the given description. Five descriptions here, one per basic land
// type (CR 305.6 names exactly those five), and each found card answers ONE of
// them: the injective rule `gre/categorizedPick.ts` computes, not the COVER
// rule `chooseCategorized` applies to a battlefield. The difference is not
// stylistic — the cards found LEAVE the library and go onto the battlefield, so
// a Tundra cannot be the card found for "Plains" and again for "Island" the way
// Planar Overlay's ruling lets a dual land be nominated as two land types it
// merely keeps sitting under.
//
// CR 701.23b — searching a hidden zone for cards with a stated quality never
// obliges the searcher to find them, so every category is a "you may" and the
// offer floors at zero: `count: { min: 0, max: 5 }`, clamped down by the
// interpreter to the size of the maximum matching. A library with three Forests
// and nothing else offers ONE card, not three and not five.
//
// The additional cost is five LANDS, any lands (CR 601.2f / 118.8) — the first
// counted `sacrificeFilter`, which is why `additionalCosts.sacrificeFilterCount`
// exists. CR 601.2h makes the cast illegal below five: the lands are gone before
// the spell resolves, which is the whole point of the card.
//
// CR 701.23e — the found cards are NOT revealed (no reveal clause in the text),
// so no `reveal` Op rides along; CR 701.24 shuffles at the end.
// hand-tail: "Search your library for a land card of each basic land type, put those cards onto the battlefield, then shuffle." (#4330)
export const gaeasBalance: CardDefinition = {
    id: "f1ffc5f8-ff1c-4733-b046-8679fa16371b",
    rarity: "uncommon",
    name: "Gaea's Balance",
    oracleText:
        "As an additional cost to cast this spell, sacrifice five lands.\nSearch your library for a land card of each basic land type, put those cards onto the battlefield, then shuffle.",
    manaCost: { X: 3, G: 1 },
    types: ["Sorcery"],
    additionalCosts: {
        sacrificeFilter: { types: "Land" },
        sacrificeFilterCount: 5,
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            categories: [
                {
                    label: "Plains",
                    filter: { type: "Land", subtype: "Plains" },
                },
                {
                    label: "Island",
                    filter: { type: "Land", subtype: "Island" },
                },
                { label: "Swamp", filter: { type: "Land", subtype: "Swamp" } },
                {
                    label: "Mountain",
                    filter: { type: "Land", subtype: "Mountain" },
                },
                {
                    label: "Forest",
                    filter: { type: "Land", subtype: "Forest" },
                },
            ],
            count: { min: 0, max: 5 },
            prompt: "Search your library for a land card of each basic land type.",
            bind: "$found",
        },
        {
            op: "moveZone",
            cards: { ref: "$found" },
            player: "controller",
            from: "library",
            to: "battlefield",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};
