// ema (Eternal Masters) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardPrint } from "../../types";

// manaCrypt — EMA reprint of the PHPR (HarperPrism Book Promos) definition
// (CardPrint, issue #1367). The card was first drafted against this
// printing; its home set is its earliest paper printing (ADR 0041) — a 1994
// promotional insert bundled with the novel "Arena", per Scryfall's own
// `reprint` flag — so the mechanics live in `phpr/colorless.ts`.
export const manaCryptEma: CardPrint = {
    printId: "0cb33b46-4d1b-4f97-bfdc-d815aee111da", // EMA
    definitionId: "160cf235-6463-4e16-a426-8b5be76b10d2", // manaCrypt (HarperPrism Book Promos)
    setCode: "ema",
    rarity: "mythic",
};
