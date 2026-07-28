// wth — blue cards (ADR 0043 colour split).

// Disrupt — {U} Instant. "Counter target instant or sorcery spell unless its
// controller pays {1}. Draw a card." (CR 701.5a counter/punisher pattern +
// CR 121.1 draw.) `mayPay` + `if` on the outcome is the shipped punisher
// template (leg/blue.ts Force Spike / fem/blue.ts Vodalian Mage).
//
// Home set = earliest paper printing (ADR 0041) = Weatherlight; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/blue.ts`.
import type { CardDefinition } from "../../types";
export const disrupt: CardDefinition = {
    id: "c6cc89b0-9acf-452b-ac1a-bc7e90eb32fc", // WTH 37
    name: "Disrupt",
    rarity: "common",
    oracleText:
        "Counter target instant or sorcery spell unless its controller pays {1}.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Instant", "Sorcery"],
    },
    effects: [
        {
            op: "mayPay",
            player: { controllerOf: { target: 0 } },
            cost: { X: 1 },
            prompt: "Pay {1} or your spell is countered (Disrupt)?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
