// TOR (Torment) — green cards, split by colour per ADR 0043. The registry's
// `import * as tor from "./sets/tor"` resolves through tor/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Basking Rootwalla — {G} Creature — Lizard, 1/1. "{1}{G}: This creature gets
// +2/+2 until end of turn. Activate only once each turn.\nMadness {0}." (CR 605
// pump activated ability with `oncePerTurn`, template Fire Drake `drk/red.ts`;
// CR 702.35 Madness — the discard→exile cast capability, `convex/gre/madness.ts`.
// `Madness {0}` is the empty cost `{}`.)
export const baskingRootwalla: CardDefinition = {
    id: "1a67768a-6cd9-4163-b941-752f29c87a8d",
    rarity: "common",
    name: "Basking Rootwalla",
    oracleText:
        "{1}{G}: This creature gets +2/+2 until end of turn. Activate only once each turn.\nMadness {0} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Lizard"],
    power: 1,
    toughness: 1,
    madness: {},
    activatedAbilities: [
        {
            id: "basking-rootwalla-pump",
            oracleText:
                "{1}{G}: This creature gets +2/+2 until end of turn. Activate only once each turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            oncePerTurn: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
