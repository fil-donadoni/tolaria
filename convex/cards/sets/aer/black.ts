// AER — black cards, split by colour per ADR 0043. The registry's
// `import * as aer from "./sets/aer"` resolves through aer/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Fatal Push — {B} Instant. "Destroy target creature if it has mana value 2 or
// less. Revolt — Destroy that creature if it has mana value 4 or less instead
// if a permanent left the battlefield under your control this turn." (Revolt
// ability word — engine infra, no registry row.)
//
// resolve() justified: the card combines two runtime checks — the revolt flag
// (a per-player "a permanent you controlled left this turn") and the target
// creature's mana value — against a variable threshold (2 without revolt, 4
// with revolt). The frozen predicate grammar does not express "target's mana
// value" as an EffectValue.
export const fatalPush: CardDefinition = {
    id: "b5e81649-9954-424c-89d1-f87d73b66047",
    rarity: "uncommon",
    name: "Fatal Push",
    oracleText:
        "Destroy target creature if it has mana value 2 or less.\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx) => {
        const target = ctx.targets[0];
        if (!target) return;
        const threshold = ctx.hasRevolt(ctx.controller) ? 4 : 2;
        if (ctx.getManaValue(target) <= threshold) {
            ctx.destroy(target);
        }
    },
};
