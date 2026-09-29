// m11 — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardPrint } from "../../types";

// Portal reprint of the M11 printing this card was first implemented against.
// Home set = earliest paper printing (ADR 0041), so the mechanics live in
// `por/black.ts` and M11 declares only this printing.
export const mindRotM11: CardPrint = {
    printId: "5e117056-030a-4ec6-a669-dbe6c7ccb840", // M11 106
    definitionId: "b91d355d-8409-4f0b-87ce-7590a8b9ebc0", // mindRot (Portal)
    setCode: "m11",
    rarity: "common",
};
