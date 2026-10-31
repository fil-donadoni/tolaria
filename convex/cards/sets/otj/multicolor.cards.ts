// OTJ — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Pillage the Bog — {B}{G} Sorcery (issue #3219). Two lines, two shapes:
//   • "Look at the top X cards of your library, where X is twice the number of
//     lands you control. Put one of them into your hand and the rest on the
//     bottom of your library in a random order." — the `lookDistribute` Op
//     with `look` = the lands you control counted with the `times: 2` scaling
//     factor ("twice the number of"), one card to hand, and `randomBottom` for
//     the bottom placement: no ordering pick and no knowledge granted (CR
//     401.4 — the owner does not reveal the order). No new Op.
//   • "Plot {1}{B}{G}" — the plot special action (CR 702.170, `gre/plot.ts`).
//
// compiler-gap: "Look at the top X cards of your library, where X is twice the number of lands you control. Put one of them into your hand and the rest on the bottom of your library in a random order." (#2693)
export const pillageTheBog = defineCard(() => ({
    id: "fa3b415f-7901-4ab4-84fe-60b90d40ac90",
    rarity: "rare",
    name: "Pillage the Bog",
    oracleText:
        "Look at the top X cards of your library, where X is twice the number of lands you control. Put one of them into your hand and the rest on the bottom of your library in a random order.\nPlot {1}{B}{G} (You may pay {1}{B}{G} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)",
    manaCost: { B: 1, G: 1 },
    types: ["Sorcery"],
    plot: { X: 1, B: 1, G: 1 },
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: { type: "Land" },
                    times: 2,
                },
            },
            take: 1,
            randomBottom: true,
        },
    ],
}));
