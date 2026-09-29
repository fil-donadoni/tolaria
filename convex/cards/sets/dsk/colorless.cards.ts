// dsk (Duskmourn: House of Horror) — colorless cards (ADR 0043 colour
// split). Modern Scryfall oracle text is authoritative (ADR 0004). Lands and
// colourless artifacts (no coloured cost) live here per the colour-split
// convention.

import type { CardDefinition } from "../../types";
import { makeVergeLand } from "../../abilities";

// The DSK "Verge" cycle — see `makeVergeLand` in
// `convex/cards/abilities/index.ts` for the shared board-conditional
// second-ability shape. Vintage Cube free tranche (issue #675, ADR 0041).
export const thornspireVerge: CardDefinition = makeVergeLand({
    id: "7e1cdc03-6faa-4138-9a52-caafbe34fb59",
    name: "Thornspire Verge",
    rarity: "rare",
    primary: "R",
    secondary: "G",
    unlockedBy: ["Mountain", "Forest"],
});

export const blazemireVerge: CardDefinition = makeVergeLand({
    id: "d151c8e2-d715-470d-868a-f45191db9fa0",
    name: "Blazemire Verge",
    rarity: "rare",
    primary: "B",
    secondary: "R",
    unlockedBy: ["Swamp", "Mountain"],
});
