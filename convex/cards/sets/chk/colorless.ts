// chk — colorless cards (ADR 0043 colour split).

// import type { CardDefinition } from "../../types";

// Sensei's Divining Top — "{1}: Look at the top three cards of your
// library, then put them back in any order.\n{T}: Draw a card, then put
// this artifact on top of its owner's library." (issue #1306, parent PRD
// #620.) The FIRST ability is free (`scryReorder`, `count: 3`, `destination:
// "none"` — the exact order-only shape the Op's own doc comment cites as
// the "Ponder" precedent). STOP-AND-ISSUE on the SECOND: "put this artifact
// on top of its owner's library" has no primitive. `moveZone`'s target-based
// shape (`convex/gre/effects/interpreter.ts`) only handles a battlefield
// permanent for `to: "hand"` (a plain bounce) — every other destination
// "needs leaves-the-battlefield handling and is skipped" per its own
// comment. The underlying state-layer `removePermanentTo` DOES accept
// `"library"` as a destination, but the generic `moveCard` primitive it
// calls appends to the END of the zone array — the BOTTOM of the library
// (`library[0]` is top) — and `putHandCardOnTopOfLibrary` (the only
// existing top-of-library primitive) is HAND-only (Sylvan Library,
// Brainstorm's put-back), not battlefield. Never ship a silent partial
// (CLAUDE.md) — the whole card stays a stub rather than shipping the scry
// ability alone. Stop-and-issue per gre-development.md; tracked-by: #1369
// export const senseisDiviningTop: CardDefinition = {
//     id: "4a08ca06-58db-4ce6-b490-be4bea8956a1",
//     name: "Sensei's Divining Top",
//     rarity: "rare",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
// };

export {};
