// LTR — blue cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// Lórien Revealed — {3}{U}{U} Sorcery. "Draw three cards. Islandcycling {1}
// ({1}, Discard this card: Search your library for an Island card, reveal
// it, put it into your hand, then shuffle.)" SIMPLIFIED (documented
// deviation): only the main sorcery effect (CR 121.1 draw) ships here.
// Islandcycling (CR 702.29, a `[Subtype]cycling` variant) is `status:
// "planned"` in mechanicsRegistry.ts — no cycling special action exists yet
// (tracked-by #689). The card is otherwise fully correct as a plain "Draw
// three cards" sorcery; it just lacks its extra alternate-cast mode.
export const lorienRevealed: CardDefinition = {
    id: "0ce44270-a684-4489-9077-521456e6dfaa",
    name: "Lórien Revealed",
    rarity: "common",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    oracleText:
        "Draw three cards.\nIslandcycling {1} ({1}, Discard this card: Search your library for an Island card, reveal it, put it into your hand, then shuffle.)",
    effects: [{ op: "draw", player: "controller", count: 3 }],
};
