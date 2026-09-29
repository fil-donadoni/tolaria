// BTD (Beatdown Box Set, 2000). A reprint box set with no new cards; this
// module carries only the CardPrint entries needed to make earlier definitions
// legal in Premodern. Each CardPrint declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> the shared CardDefinition.
// See ADR 0014 and issue #980.

import type { CardPrint } from "../../types";

// Ball Lightning — Premodern-legal reprint (Beatdown Box Set, #980). Resolves
// to the DRK CardDefinition; the printId is the BTD per-print Scryfall UUID.
export const ballLightningBtd: CardPrint = {
    printId: "6312e369-aef7-486e-a689-97eef04c71d8",
    definitionId: "c1ba83ab-83f5-421d-bba1-0f925870b5c8", // Ball Lightning
    setCode: "btd",
    rarity: "rare",
};
