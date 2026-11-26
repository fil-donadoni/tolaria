// MOR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mor from "./sets/mor/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Mutavault — the manland whose body is every creature type. DSL-first (ADR
// 0045): the `animate` Op (issue #1317) with `allCreatureTypes: true`
// (CR 205.3m, issue #10511) — a layer-4 ADD of every creature type at the
// animation's own timestamp, ending with it "until end of turn" (CR 611.2a).
// Not changeling (CR 702.73a): the land is a Merfolk only while animated, so a
// Merfolk lord pumps it then and never while it is only a land.
// "It's still a land" (CR 205.1b): `animate` adds Creature to the printed line.
// hand-tail: {1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land. (#10511)
export const mutavault = defineCard(() => ({
    id: "8ca3c48b-f104-4292-9a4e-2ce87a65893c",
    rarity: "rare",
    name: "Mutavault",
    oracleText:
        "{T}: Add {C}.\n{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "mutavault-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "mutavault-animate",
            oracleText:
                "{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.",
            cost: { mana: { X: 1 } },
            useStack: true,
            animatesSelf: true,
            effects: [
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    allCreatureTypes: true,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
}));
