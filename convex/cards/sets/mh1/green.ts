// mh1 — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Force of Vigor — {2}{G}{G} Instant. "If it's not your turn, you may exile a
// green card from your hand rather than pay this spell's mana cost. Destroy up
// to two target artifacts and/or enchantments." (CR 118.9 alternative pitch
// cost — exile a green card from hand, gated on the not-your-turn condition;
// CR 701.8 destroy; CR 601.2c "up to two" targeting.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `handCost.action: "exile"` leg with `condition: not-your-turn`. The effect
// reuses the already-censused `destroy` Op on each of the up-to-two announced
// targets ({ target: 0 } / { target: 1 }); an unchosen second target resolves
// to nothing and its Op is skipped (CR 608.2b), so 0/1/2 targets all work
// (ADR 0045, DSL-first).
export const forceOfVigor: CardDefinition = {
    id: "017c415b-d635-43c6-92b8-8c95d1c4ff8d", // MH1 164
    rarity: "rare",
    name: "Force of Vigor",
    oracleText:
        "If it's not your turn, you may exile a green card from your hand rather than pay this spell's mana cost.\nDestroy up to two target artifacts and/or enchantments.",
    manaCost: { X: 2, G: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: ["Artifact", "Enchantment"],
        count: { min: 0, max: 2 },
    },
    alternativeCosts: [
        {
            id: "pitch-exile-green",
            description: "Exile a green card from your hand",
            condition: { kind: "not-your-turn" },
            hand: {
                action: "exile",
                requirements: [{ filter: { color: "G" }, count: 1 }],
            },
        },
    ],
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "destroy", target: { target: 1 } },
    ],
};
