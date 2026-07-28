// FIN — black cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardPrint } from "../../types";

// Dark Confidant — FIN reprint of the RAV definition (CardPrint). The card
// was first implemented here against this printing; its home set is its
// earliest paper printing, Ravnica: City of Guilds (ADR 0041), so the
// mechanics live in `rav/black.ts` and FIN declares only this printing.
export const darkConfidantFin: CardPrint = {
    printId: "2520ab23-a068-4462-b261-2754409b4108", // FIN 205
    definitionId: "94f7a441-bf2d-46fb-a7b6-9bd6137f86d9", // darkConfidant (RAV)
    setCode: "fin",
    rarity: "mythic",
};
