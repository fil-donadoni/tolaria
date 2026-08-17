// plc — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Mana Tithe — "Counter target spell unless its controller pays {1}." (CR
// 701.5a counter-unless-pay, CR 117.3a may-pay). The white Force Spike
// (leg/blue.ts) — same mayPay + if(not $paid) + counter shape, one Op
// vocabulary, no card-specific logic (issue #683).
export const manaTithe: CardDefinition = {
    id: "7d48d622-f397-4f31-b1a5-0c23f60aa71c",
    rarity: "common",
    name: "Mana Tithe",
    oracleText: "Counter target spell unless its controller pays {1}.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 1 },
            prompt: "Pay {1} to prevent your spell from being countered?",
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
