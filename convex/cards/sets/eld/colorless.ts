// ELD — colorless cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Fabled Passage — "{T}, Sacrifice this land: Search your library for a basic
// land card, put it onto the battlefield tapped, then shuffle. Then if you
// control four or more lands, untap that land." (CR 701.19 / 400.7 / 701.20.)
// No life payment (unlike the classic fetchlands). DSL: `choice` filtered by
// `supertype: "Basic"` + `moveZone(cards, tapped: true)` (forces the entering
// land tapped, issue #677) + `libraryLook`(shuffle). SIMPLIFIED (documented
// deviation): the "then if you control four or more lands, untap that land"
// conditional untap is NOT modelled — no Op yet lets a later step target the
// SPECIFIC permanent a `moveZone` cards-shape just moved (the shape has no
// `bind`, unlike `destroy`/`exile`). The land always stays tapped. Flag for a
// future extension if this matters competitively.
export const fabledPassage: CardDefinition = {
    id: "b841bfa8-7c17-4df2-8466-780ab9a4a53a",
    name: "Fabled Passage",
    rarity: "rare",
    oracleText:
        "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "fabled-passage-fetch",
            oracleText:
                "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
            cost: { tap: true, sacrifice: true },
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
                    tapped: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
