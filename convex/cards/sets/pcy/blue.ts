// PCY (Prophecy) — blue cards, split by colour per ADR 0043. The registry's
// `import * as pcy from "./sets/pcy"` resolves through pcy/index.ts.
import type { CardDefinition } from "../../types";

// Foil — {2}{U}{U} Instant. "You may discard an Island card and another card
// rather than pay this spell's mana cost. Counter target spell." (CR 118.9
// alternative pitch cost — DISCARD leg; CR 701.9 discard; CR 701.6a counter;
// issue #1003.) The alternative cost is a censusless CR 118.9 rules concept (no
// keyword name) with a two-requirement hand-discard leg (an Island card + any
// other distinct card); the on-resolution effect is a single already-censused
// `counter` Op (ADR 0045, DSL-first).
export const foil: CardDefinition = {
    id: "870fb793-3107-4cb2-ba78-34fbf5c9da2f", // PCY 34
    rarity: "uncommon",
    name: "Foil",
    oracleText:
        "You may discard an Island card and another card rather than pay this spell's mana cost.\nCounter target spell.",
    manaCost: { X: 2, U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    alternativeCosts: [
        {
            id: "pitch-discard-island-and-card",
            description: "Discard an Island card and another card",
            hand: {
                action: "discard",
                requirements: [
                    { filter: { subtype: "Island" }, count: 1 },
                    { filter: {}, count: 1 },
                ],
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 } }],
};
