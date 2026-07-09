// NEM — blue cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Accumulated Knowledge — {1}{U} Instant. "Draw a card, then draw cards equal
// to the number of cards named Accumulated Knowledge in all graveyards."
// (CR 121.1 draw; CR 122 counting; CR 201.2 name match.) First printed in
// Nemesis (issue #985 said mmq/blue.ts, but the card has no Mercadian Masques
// printing — its earliest set is Nemesis, so it lives here per ADR 0043).
//
// DSL-first (ADR 0045): two sequential `draw` Ops, no new Op. The first draws
// the base card; the second draws one per copy of this card in ANY graveyard,
// via the existing `count` value construct generalized with `acrossAllPlayers`
// (CR 122 — "in all graveyards") and a `name` filter (CR 201.2 — "cards named
// Accumulated Knowledge"). The resolving copy is on the stack, not a graveyard,
// so it is naturally excluded: 0 copies in graveyards → draw 1; 1 copy → draw 2.
export const accumulatedKnowledge: CardDefinition = {
    id: "ab061406-38f4-40e7-a9ea-e3cbcaabc127", // NEM 26
    rarity: "common",
    name: "Accumulated Knowledge",
    oracleText:
        "Draw a card, then draw cards equal to the number of cards named Accumulated Knowledge in all graveyards.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [
        { op: "draw", player: "controller", count: 1 },
        {
            op: "draw",
            player: "controller",
            count: {
                count: {
                    zone: "graveyard",
                    acrossAllPlayers: true,
                    filter: { name: "Accumulated Knowledge" },
                },
            },
        },
    ],
};

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
