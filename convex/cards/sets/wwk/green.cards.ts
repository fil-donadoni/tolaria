// wwk — green cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Nature's Claim — "Destroy target artifact or enchantment. Its controller
// gains 4 life." CR 701.8a (destroy) then CR 119.3 (life gain). `destroy`
// binds the permanent before it leaves the battlefield so `gainLife` reads
// its controller from last-known information (CR 608.2h) — the Swords to
// Plowshares shape (lea/white.cards.ts), no `resolve()`.
// hand-tail: Destroy target artifact or enchantment. Its controller gains 4 life. (#8601)
export const naturesClaim = defineCard(() => ({
    id: "64ae5a91-ac54-4222-832e-d7a740a3f7cb",
    rarity: "common",
    name: "Nature's Claim",
    oracleText:
        "Destroy target artifact or enchantment. Its controller gains 4 life.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 }, bind: "$perm" },
        {
            op: "gainLife",
            player: { ref: "$perm.controller" },
            amount: 4,
        },
    ],
}));
