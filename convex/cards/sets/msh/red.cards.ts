// MSH — red cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Hex Magic — {2}{R} Sorcery — Arcane. "Exile all the cards from your hand,
// then draw that many cards. Until the end of your next turn, you may play
// cards exiled this way." (CR 406.1 exile zone, CR 121.1 draw, CR 305.9 /
// CR 601.3 "play" = cast or land drop.) The whole-zone `moveZone` exiles the
// hand and binds how many cards it took (`bindCount`, read BEFORE the move, so
// an empty hand binds 0) and which ones (`bindAll`); the draw reads the count
// back, and the play permission reaches exactly the bound cards — never the
// cards drawn afterwards. "Play" includes lands, hence `includesLand`.
// hand-tail: Exile all the cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way. (#8622)
export const hexMagic = defineCard(() => ({
    id: "259bed47-1950-43ae-8efd-3009537529a8",
    name: "Hex Magic",
    rarity: "uncommon",
    oracleText:
        "Exile all the cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way.",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    subtypes: ["Arcane"],
    effects: [
        {
            op: "moveZone",
            player: "controller",
            from: "hand",
            to: "exile",
            bindCount: "$n",
            bindAll: "$exiled",
        },
        { op: "draw", player: "controller", count: { ref: "$n" } },
        {
            op: "grantCastFromExile",
            card: { ref: "$exiled" },
            player: "controller",
            window: "until-end-of-your-next-turn",
            includesLand: true,
        },
    ],
}));
