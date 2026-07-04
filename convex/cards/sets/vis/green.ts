// VIS — green cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Natural Order — {2}{G}{G} Sorcery. "As an additional cost to cast this
// spell, sacrifice a green creature. Search your library for a green
// creature card, put it onto the battlefield, then shuffle." (CR 117.9
// additional cost / 701.19 search / 400.7 / 701.20 shuffle.) The additional
// cost reuses `additionalCosts.sacrificeFilter` (a `PermanentFilter`, already
// supports `colors`); the search reuses the `choice` Op's `filter.color`
// (issue #677).
export const naturalOrder: CardDefinition = {
    id: "0845f0b0-9413-4ddd-861d-9607636bebc6",
    name: "Natural Order",
    rarity: "rare",
    manaCost: { X: 2, G: 2 },
    types: ["Sorcery"],
    oracleText:
        "As an additional cost to cast this spell, sacrifice a green creature.\nSearch your library for a green creature card, put it onto the battlefield, then shuffle.",
    additionalCosts: {
        sacrificeFilter: { types: "Creature", colors: "G" },
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: "Creature", color: "G" },
            count: 1,
            prompt: "Search your library for a green creature card.",
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
};
