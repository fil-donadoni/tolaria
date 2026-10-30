// kld — blue cards (ADR 0043 colour split).

import { defineCard, PERMANENT_TYPES } from "../../types";

// Paradoxical Outcome — {3}{U} Instant (KLD, Vintage Cube). "Return any number
// of target nonland, nontoken permanents you control to their owners' hands.
// Draw a card for each card returned to your hand this way."
//
// CR 601.2c: the target count is unbounded (`min: 1`, no `max`), as in
// Drafna's Restoration. CR 400.7 zone change; the bounce is ONE
// `forEach { set: "targets" }` sweep binding every permanent that left
// (`$returned`), and the draw reads how many the sweep captured
// (`boundCount`, filtered to `owner: "controller"` — CR 108.3: a stolen
// permanent goes to its OWNER's hand, so it is not "returned to your hand") —
// the sweep's own bindings never outlive it, and a target
// that became illegal (CR 608.2b) was never returned, so it is never counted.
//
// hand-tail: any number of target nonland, nontoken permanents you control (#7245)
export const paradoxicalOutcome = defineCard(() => ({
    id: "17e50157-bf49-4c5f-9b8a-bf73484e63a5",
    rarity: "rare",
    name: "Paradoxical Outcome",
    oracleText:
        "Return any number of target nonland, nontoken permanents you control to their owners' hands. Draw a card for each card returned to your hand this way.",
    manaCost: { U: 1, X: 3 },
    types: ["Instant"],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: { min: 1 },
        controller: "you",
        excludeTypes: "Land",
        isToken: false,
    },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    to: "hand",
                    bind: "$returned",
                },
            ],
        },
        {
            op: "draw",
            player: "controller",
            count: {
                boundCount: {
                    of: { ref: "$returned" },
                    owner: "controller",
                },
            },
        },
    ],
}));
