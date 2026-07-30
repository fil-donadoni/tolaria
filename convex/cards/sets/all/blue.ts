// ALL (Alliances) — blue cards, split by colour per ADR 0043. The registry's
// `import * as all from "./sets/all"` resolves through all/index.ts.
import type { CardDefinition } from "../../types";

// Force of Will — {3}{U}{U} Instant. "You may pay 1 life and exile a blue card
// from your hand rather than pay this spell's mana cost. Counter target spell."
// (CR 118.9 alternative pitch cost; CR 118.4 pay-life leg; CR 701.13 exile leg;
// CR 701.5a counter.) The alternative cost is a censusless CR 118.9 rules
// concept (no keyword name) built from two legs — pay 1 life + exile a blue
// card from hand — paid at cast commit; the on-resolution effect is a single
// already-censused `counter` Op (ADR 0045, DSL-first).
export const forceOfWill: CardDefinition = {
    id: "9a879b60-4381-447d-8a5a-8e0b6a1d49ca", // ALL 28
    rarity: "uncommon",
    name: "Force of Will",
    oracleText:
        "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.",
    manaCost: { X: 3, U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    alternativeCosts: [
        {
            id: "pitch-pay-1-life-exile-blue",
            description: "Pay 1 life and exile a blue card from your hand",
            life: 1,
            hand: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 } }],
};
