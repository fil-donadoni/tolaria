// Aetherdrift (DFT) — blue cards, split by colour per ADR 0043. The registry's
// `import * as dft from "./sets/dft"` resolves through dft/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Stock Up — {2}{U} Sorcery. "Look at the top five cards of your library. Put
// two of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look.) The already-censused `digToHand` Op (issue #984)
// with look 5 / take 2: it reveals the top five (projected face-up as
// `libraryPeek` — never the whole library, the `search-library` over-exposure),
// drives the unified HAND/BOTTOM pick (two to hand), bottoms the rest in the
// player's chosen order (CR 401.4 "in any order" is a real choice — ADR 0026)
// and marks those bottomed cards known to the controller.
export const stockUp: CardDefinition = {
    id: "0a786855-6eb4-42c0-a528-4842db46809d",
    name: "Stock Up",
    rarity: "rare",
    oracleText:
        "Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [{ op: "digToHand", player: "controller", look: 5, take: 2 }],
};
