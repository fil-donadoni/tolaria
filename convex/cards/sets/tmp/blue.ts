// TMP — blue cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// Reprint-only entries: each CardPrint declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> the shared CardDefinition
// (ADR 0014).

import type { CardPrint } from "../../types";

// Counterspell — Premodern-legal reprint (Tempest, #980). Resolves to the LEA
// CardDefinition; the printId is the TMP per-print Scryfall UUID.
export const counterspellTmp: CardPrint = {
    printId: "dacdd380-71cf-4832-bd02-3697501325f3",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "tmp",
    rarity: "common",
};
