// EMN — green cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Eldritch Evolution — {1}{G}{G} Sorcery. "As an additional cost to cast this
// spell, sacrifice a creature. Search your library for a creature card with
// mana value X or less, where X is 2 plus the sacrificed creature's mana
// value. Put that card onto the battlefield, then shuffle. Exile Eldritch
// Evolution."
//   - CR 118.8 / 601.2f — the sacrifice is an additional cost paid at cast
//     (`additionalCosts.sacrificeFilter`), so the creature is gone before the
//     spell resolves.
//   - CR 608.2h — X reads the victim's last known mana value off the stack
//     item's cost-sacrifice snapshot: `manaValueAtMost: { sacrificed: { read:
//     "manaValue", plus: 2 } }`.
//   - CR 701.23b — a stated quality never compels the find (`min: 0`);
//     CR 701.24a — then shuffle.
//   - CR 608.2n — the spell would go to its owner's graveyard as the last
//     part of resolution; "Exile Eldritch Evolution" sends it to exile
//     instead (`exileSelf`).
//
// hand-tail: Search your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile {self}. (#10536)
export const eldritchEvolution = defineCard(() => ({
    id: "efcb00e5-2caa-45c8-ad19-05d45c683d16", // EMN 155
    name: "Eldritch Evolution",
    rarity: "rare",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle. Exile Eldritch Evolution.",
    manaCost: { X: 1, G: 2 },
    types: ["Sorcery"],
    additionalCosts: {
        sacrificeFilter: { types: "Creature" },
    },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: {
                type: "Creature",
                manaValueAtMost: { sacrificed: { read: "manaValue", plus: 2 } },
            },
            count: { min: 0, max: 1 },
            prompt: "Search your library for a creature card with mana value X or less (X = 2 + the sacrificed creature's mana value).",
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
        { op: "exileSelf" },
    ],
}));
