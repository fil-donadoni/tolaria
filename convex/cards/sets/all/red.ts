// ALL (Alliances) — red cards, split by colour per ADR 0043. The registry's
// `import * as all from "./sets/all"` resolves through all/index.ts.
import type { CardDefinition, SpellContext } from "../../types";

// Pyrokinesis — {4}{R}{R} Instant. "You may exile a red card from your hand
// rather than pay this spell's mana cost. Pyrokinesis deals 4 damage divided as
// you choose among any number of target creatures." (CR 118.9 alternative pitch
// cost — exile a red card from hand; CR 601.2d / 120.4 divide as you choose.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name),
// handled by the cost system (`handCost.action: "exile"`). The DIVIDED-damage
// effect is NOT expressible as a declarative Op (the value grammar has no
// runtime split), so — matching the shipped Fiery Justice / Fire Covenant
// pattern (ice/multicolor.ts) — it stays `resolve()` and drives the shared
// `dealDamageDividedAsChosen` primitive off the `divideAsChosen` target group.
// protocol card: divided-damage-as-chosen has no Effect Script Op (arithmetic
// split of a fixed total among a runtime-sized target set).
export const pyrokinesis: CardDefinition = {
    id: "db2a5e85-6cbc-43c1-9362-4056ad017ef0", // ALL 78
    rarity: "uncommon",
    name: "Pyrokinesis",
    oracleText:
        "You may exile a red card from your hand rather than pay this spell's mana cost.\nPyrokinesis deals 4 damage divided as you choose among any number of target creatures.",
    manaCost: { X: 4, R: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: { min: 1 },
        divideAsChosen: { total: 4 },
    },
    alternativeCosts: [
        {
            id: "pitch-exile-red",
            description: "Exile a red card from your hand",
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "R" }, count: 1 }],
            },
        },
    ],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageDividedAsChosen(ctx.targets, 4);
    },
};
