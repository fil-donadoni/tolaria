// SHM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { colorChoiceModes } from "../../abilities/chooseColor";

// Manamorphose — {1}{R/G} Instant. "Add two mana in any combination of
// colors. Draw a card." (issue #1368.)
//
// The cost is one guild-hybrid pip (`hybrid: [["R", "G"]]`, the Deathrite
// Shaman shape). "Two mana in any combination of colors" is two INDEPENDENT
// colour choices — the same colour twice is legal — so it is the counted
// repetition `forEach { set: "times", count: 2 }` around the one-mana-of-any-
// color `optionChoice` (`colorChoiceModes`, one fixed-pip `addMana` per mode,
// The Legend of Roku's chapter II). CR 106.1a — five colours, never
// colourless. Not a mana ability: the spell resolves off the stack, then draws.
// hand-tail: Add two mana in any combination of colors. (#1368)
export const manamorphose = defineCard(() => ({
    id: "50283122-b8c4-4fb3-8eba-6252b72222f4",
    name: "Manamorphose",
    rarity: "common",
    oracleText: "Add two mana in any combination of colors.\nDraw a card.",
    manaCost: { X: 1, hybrid: [["R", "G"]] },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: { set: "times", count: 2 },
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a color to add one mana of.",
                    modes: colorChoiceModes((color) => [
                        { op: "addMana", mana: { [color]: 1 } },
                    ]),
                },
            ],
        },
        { op: "draw", player: "controller", count: 1 },
    ],
}));
