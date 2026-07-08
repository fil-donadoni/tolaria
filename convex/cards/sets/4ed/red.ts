// 4ED (Fourth Edition). A white-bordered core reprint set with no new cards;
// this module carries only the CardPrint entries needed to make earlier
// definitions legal in Premodern (4th Edition is the earliest Premodern-legal
// set). Each CardPrint declares the per-edition Scryfall UUID (printId) and
// resolves printId -> definitionId -> the shared CardDefinition. See ADR 0014
// and issue #980.

import type { CardPrint } from "../../types";

// Lightning Bolt — Premodern-legal reprint (4th Edition, #980). Resolves to the
// LEA CardDefinition; the printId is the 4ED per-print Scryfall UUID.
export const lightningBolt4ed: CardPrint = {
    printId: "9521375e-0bc1-45ef-b513-6d332a25f9d2",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt
    setCode: "4ed",
    rarity: "common",
};
