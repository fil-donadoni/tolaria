// TOR (Torment) — blue cards, split by colour per ADR 0043. The registry's
// `import * as tor from "./sets/tor"` resolves through tor/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Circular Logic — {2}{U} Instant. "Counter target spell unless its controller
// pays {1} for each card in your graveyard.\nMadness {U}" (CR 118.12a — "[do
// something] unless [a player does something else]" means "[that player may do
// something else]. If [they don't], [do something]"; CR 701.6a counter; CR
// 702.35 Madness, the discard-to-exile cast capability in `gre/madness.ts`.)
//
// Mana Leak's mayPay + `if (not $paid)` + `counter` shape (`sth/blue.ts`), with
// the tax read at RESOLUTION rather than printed: `genericEqualTo` is the
// fourth `mayPay` cost shape (issue #2714), the exact twin of the energy
// shape's `energyEqualTo`, and the tally reuses the ordinary `count`
// `EffectValue` — the same one Cabal Ritual's threshold predicate uses one
// file over. "YOUR graveyard" is Circular Logic's controller's (CR 109.5),
// which is `"controller"` here, NOT the taxed player's.
//
// An empty graveyard prices the tax at {0}, which CR 118.3a makes payable by
// anyone — so the spell resolves, the opponent pays nothing and the counter
// never happens. That is the printed card, not a degenerate case to guard.
//
// compiler-gap: "Counter target spell unless its controller pays {1} for each card in your graveyard." (#2693)
export const circularLogic: CardDefinition = {
    id: "cd9198d6-201d-4175-8f70-eef92d7d5bb5",
    rarity: "uncommon",
    name: "Circular Logic",
    oracleText:
        "Counter target spell unless its controller pays {1} for each card in your graveyard.\nMadness {U} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    madness: { U: 1 },
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 118.12a — the TAXED player is the target spell's controller.
            player: { controllerOf: { target: 0 } },
            cost: {
                genericEqualTo: {
                    count: { zone: "graveyard", controller: "controller" },
                },
            },
            prompt: "Pay {1} for each card in their graveyard to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.6a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
