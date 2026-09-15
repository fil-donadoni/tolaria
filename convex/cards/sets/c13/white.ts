// c13 — white cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";

// Unexpectedly Absent (issue #3242) — "Put target nonland permanent into its
// owner's library just beneath the top X cards of that library." A positional
// library insert whose position is the spell's own X: `{ beneathTop: X }` keeps
// X cards above it, so X = 0 is the top of the library (the official ruling —
// the card's whole trick) and a library with fewer than X cards puts it on the
// bottom. CR 400.3 sends it to its OWNER's library, whoever controls it.
//
// compiler-gap: "Put target nonland permanent into its owner's library just beneath the top X cards of that library." (#2693)
export const unexpectedlyAbsent: CardDefinition = {
    id: "6dff437b-ef68-48f7-afd3-3b72d3c56187",
    name: "Unexpectedly Absent",
    rarity: "rare",
    oracleText:
        "Put target nonland permanent into its owner's library just beneath the top X cards of that library.",
    manaCost: { X: "X", W: 2 },
    types: ["Instant"],
    // CR 115.1c — "target nonland permanent" (any controller's).
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        excludeTypes: "Land",
        count: 1,
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "library",
            position: { beneathTop: { X: true } },
        },
    ],
};
