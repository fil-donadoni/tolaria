// m11 — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardPrint } from "../../types";

// Planar Chaos reprint of the M11 printing this card was first implemented against.
// Home set = earliest paper printing (ADR 0041), so the mechanics live in
// `plc/red.ts` and M11 declares only this printing.
export const prodigalPyromancerM11: CardPrint = {
    printId: "081dba98-2092-4225-8e9e-214fb9263b1c", // M11 148
    definitionId: "97787109-408e-42d3-acc5-300f5f5bf2ff", // prodigalPyromancer (Planar Chaos)
    setCode: "m11",
    rarity: "uncommon",
};
