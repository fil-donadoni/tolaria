// PTK — black cards, split by colour per ADR 0043. The registry's
// `import * as ptk from "./sets/ptk"` resolves through ptk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Imperial Seal — {B} Sorcery. "Search your library for a card, then
// shuffle and put that card on top. You lose 2 life." (CR 701.19 search /
// 701.20 shuffle / 401.4 top-of-library / 119.3 life loss, issue #1125 —
// same shape as Vampiric Tutor, unblocked by the `moveZone` `to:
// "library-top"` destination.)
export const imperialSeal: CardDefinition = {
    id: "822e30db-40c5-4099-868b-185ad9b7c7dc",
    name: "Imperial Seal",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    oracleText:
        "Search your library for a card, then shuffle and put that card on top. You lose 2 life.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: { min: 0, max: 1 },
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "library-top",
        },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};
