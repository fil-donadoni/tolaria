// MKM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm"` resolves through mkm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// No More Lies — {W}{U} Instant. "Counter target spell unless its controller
// pays {3}. If that spell is countered this way, exile it instead of putting
// it into its owner's graveyard." (CR 701.5a counter-unless-pay, CR 117.3a
// may-pay, and the new `destination` parameter on `SpellContext.counter` —
// issue #683's "exile it instead" redirect clause.) Same mayPay + if(not
// $paid) + counter shape as Force Spike (leg/blue.ts), with a `destination`
// override on the consequence.
export const noMoreLies: CardDefinition = {
    id: "1e0c695d-62f9-4805-9e2f-7032e8464136",
    rarity: "uncommon",
    name: "No More Lies",
    oracleText:
        "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    manaCost: { W: 1, U: 1 },
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
            // CR 701.5a — counter unless the payment was made; redirect to
            // exile instead of the graveyard default.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [
                {
                    op: "counter",
                    target: { target: 0 },
                    destination: "exile",
                },
            ],
        },
    ],
};
