// m11 — white cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardPrint } from "../../types";

// Zendikar reprint of the M11 printing this card was first implemented against.
// Home set = earliest paper printing (ADR 0041), so the mechanics live in
// `zen/white.ts` and M11 declares only this printing.
export const dayOfJudgmentM11: CardPrint = {
    printId: "03f6b25f-d11c-483a-a3e9-6b801d333482", // M11 6
    definitionId: "2aa98fca-972b-46c2-bdec-6ace35c988d5", // dayOfJudgment (Zendikar)
    setCode: "m11",
    rarity: "rare",
};
