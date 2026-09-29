// chk — colorless cards (ADR 0043 colour split). Modern Scryfall oracle
// text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Sensei's Divining Top — "{1}: Look at the top three cards of your
// library, then put them back in any order.\n{T}: Draw a card, then put
// this artifact on top of its owner's library." (issue #789, parent PRD
// #620.) Both abilities are DSL-first (ADR 0045). The FIRST is the
// order-only `scryReorder` shape (`count: 3`, `destination: "none"` —
// the Ponder precedent, `lrw/blue.ts`). The SECOND composes `draw` with a
// `moveZone` self-reference (`$source`) to `to: "library"` — a battlefield
// permanent to a specific 1-based position from the top, `position`
// omitted defaulting to 1/top (issue #1726, `putIntoLibraryFromBattlefield`)
// — closing the gap the original stub tracked as #1369.
export const senseisDiviningTop: CardDefinition = {
    id: "4a08ca06-58db-4ce6-b490-be4bea8956a1",
    name: "Sensei's Divining Top",
    rarity: "uncommon",
    oracleText:
        "{1}: Look at the top three cards of your library, then put them back in any order.\n{T}: Draw a card, then put this artifact on top of its owner's library.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "senseis-divining-top-scry",
            oracleText:
                "{1}: Look at the top three cards of your library, then put them back in any order.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 3,
                    destination: "none",
                    prompt: "Put these cards back on top in any order (rightmost = top).",
                },
            ],
        },
        {
            id: "senseis-divining-top-draw",
            oracleText:
                "{T}: Draw a card, then put this artifact on top of its owner's library.",
            cost: { tap: true },
            useStack: true,
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "moveZone",
                    target: { ref: "$source" },
                    to: "library",
                    position: 1,
                },
            ],
        },
    ],
};
