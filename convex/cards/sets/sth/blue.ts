// sth — blue cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Mana Leak — "Counter target spell unless its controller pays {3}." (CR
// 701.5a counter-unless-pay, CR 117.3a may-pay). Same mayPay + if(not $paid)
// + counter shape as Force Spike (leg/blue.ts), just a bigger tax (issue
// #683).
export const manaLeak: CardDefinition = {
    id: "abcaf16d-aa02-43e2-aa38-bb1835d47a05",
    rarity: "common",
    name: "Mana Leak",
    oracleText: "Counter target spell unless its controller pays {3}.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 3 },
            prompt: "Pay {3} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.5a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
