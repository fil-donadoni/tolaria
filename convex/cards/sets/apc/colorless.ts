// APC — colorless cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Dragon Arch — {5} Artifact. "{2}, {T}: You may put a multicolored creature
// card from your hand onto the battlefield."
//
// Sneak Attack's hand → battlefield template (usg/red.ts) with the "You may"
// spelled as `count: { min: 0, max: 1 }` — declining is a legal answer, so the
// activation is never a trap — and the ONE thing this card adds over it:
// "multicolored" (CR 105.2b) as `colorCountAtLeast: 2` rather than an OR over
// the five colours, which would admit every mono-coloured card. No follow-up
// clause at all: the creature enters and STAYS (no haste grant, no delayed
// sacrifice), which is exactly what makes this card the cheap end of the
// reanimator-adjacent shell rather than a Sneak Attack variant.
//
// `moveZone(from: "hand", to: "battlefield")` is CR 400.7's zone change; the
// creature is not CAST — casting is the process that puts a spell ON THE
// STACK (CR 601.2), and this one never goes there, so no cast-triggers fire.
//
// hand-tail: "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield." (#3806)
export const dragonArch: CardDefinition = {
    id: "eec581b8-e509-420c-b142-afaa6dd06cc8", // APC 132
    name: "Dragon Arch",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "dragon-arch-put",
            oracleText:
                "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    // CR 105.2b — "multicolored" is a COUNT of colours, never a
                    // colour: two or more of the five.
                    filter: { type: "Creature", colorCountAtLeast: 2 },
                    count: { min: 0, max: 1 },
                    prompt: "Put a multicolored creature card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};
