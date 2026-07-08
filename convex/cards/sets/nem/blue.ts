// NEM — blue cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Dominate — {X}{1}{U}{U} Instant. "Gain control of target creature with mana
// value X or less." A targeted layer-2 control change (CR 613.1b) filtered by
// mana value (CR 202.3). The control change is INDEFINITE (no "for as long
// as" clause), so the `gainControl` Op omits `duration` — the Ghazbán Ogre
// shape that never reverts on its own (issue #848).
//
// The X-dependent mana-value ceiling rides `mvFilter: { max: "X" }`, which the
// engine resolves against the chosen X at announcement (CR 107.3), restricting
// legal targets in `getLegalTargets` to creatures whose mana value is X or
// less. `{X}{1}{U}{U}` = variable X plus one fixed generic and {U}{U}, encoded
// as `X: "X"` (the variable marker) + `generic: 1` + `U: 2`.
export const dominate: CardDefinition = {
    id: "63b2dcb1-8c3e-434c-865a-196d4d799706",
    rarity: "uncommon",
    name: "Dominate",
    oracleText: "Gain control of target creature with mana value X or less.",
    manaCost: { X: "X", generic: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        mvFilter: { max: "X" },
    },
    effects: [
        {
            op: "gainControl",
            target: { target: 0 },
            controller: "controller",
        },
    ],
};
