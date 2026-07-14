// MBS — green cards, split by colour per ADR 0043. The registry's
// `import * as mbs from "./sets/mbs"` resolves through mbs/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Green Sun's Zenith — "Search your library for a green creature card with
// mana value X or less, put it onto the battlefield, then shuffle. Shuffle
// Green Sun's Zenith into its owner's library." (CR 701.23 search / 400.7 /
// 701.24 shuffle / 608.2m spell-resolution destination.) A DSL-first card
// (ADR 0045) built entirely from the tutor-to-battlefield template
// (`naturalOrder`, vis/green.ts) plus two extensions this card unblocked
// (issue #898):
//   1. `filter.manaValueAtMost: { X: true }` — the DYNAMIC "mana value X or
//      less" ceiling (as opposed to Spellseeker/Brightglass Gearhulk's FIXED
//      literal, issue #677), resolved at resolution via `ctx.getX()` through
//      the same `resolveValue` every other `EffectXValue` site uses
//      (`matchesCardFilter`, convex/gre/effects/interpreter.ts).
//   2. `shuffleSelfIntoLibrary` — the NEW Op (no prior DSL exposure) that
//      redirects THIS card's own post-resolution destination from the
//      graveyard (CR 608.2m default) to its owner's (shuffled) library,
//      mirroring the existing `exileSelf` self-redirect design (Recall)
//      but targeting the library instead of exile.
export const greenSunsZenith: CardDefinition = {
    id: "02335747-54e3-4827-ae19-4e362863da9b",
    name: "Green Sun's Zenith",
    rarity: "rare",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    oracleText:
        "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle.\nShuffle Green Sun's Zenith into its owner's library.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: {
                type: "Creature",
                color: "G",
                manaValueAtMost: { X: true },
            },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a green creature card with mana value X or less.",
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
        { op: "shuffleSelfIntoLibrary" },
    ],
};
