// ELD — colorless cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Fabled Passage — "{T}, Sacrifice this land: Search your library for a basic
// land card, put it onto the battlefield tapped, then shuffle. Then if you
// control four or more lands, untap that land." (CR 701.23 search / 400.7 /
// 701.24 shuffle / 701.26 untap; CR 608.2c — the trailing "Then if …" clause
// is later text that conditions on the game state AFTER the earlier
// instructions resolved, so the entering land counts toward its own "four or
// more lands" check.)
//
// No life payment (unlike the classic fetchlands). DSL: `choice` filtered by
// `supertype: "Basic"` + `moveZone(cards, tapped: true, bind: "$land")`
// (forces the entering land tapped, issue #677; `bind` — issue #1151 —
// snapshots the just-entered permanent so a later Op can target it
// specifically) + `libraryLook`(shuffle) + a trailing `if` (ADR 0045's third
// frozen construct) whose `EffectComparisonPredicate` compares a `count` of
// the controller's battlefield lands against 4 (the `EffectCountSpec` used by
// e.g. Ivory Tower's hand-size read, `atq/colorless.ts`); the `then` branch
// is a single `tapUntap(action: "untap", target: { ref: "$land" })` (CR
// 701.26). `resolveObjectRef` re-checks battlefield presence for `$land` at
// the point the `if` runs, so this reads the CURRENT board — the fetched
// land is already on the battlefield by then and is one of the "four or
// more lands" it's being counted against, matching the printed card's
// resolution order.
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
                "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.",
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
                    bind: "$land",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Land" },
                            },
                        },
                        op: "ge",
                        right: 4,
                    },
                    then: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$land" },
                        },
                    ],
                },
            ],
        },
    ],
};
