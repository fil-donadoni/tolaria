// M13 — blue cards, split by colour per ADR 0043. The registry's
// `import * as m13 from "./sets/m13/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Master of the Pearl Trident — {U}{U} Creature — Merfolk 2/2 (M13, modern
// Merfolk). A lord over the Merfolk its controller controls, the source
// excluded: a CR 613.4c layer-7c +1/+1 and a CR 613.1f layer-6 grant of
// islandwalk (CR 702.14c — unblockable while the defending player controls an
// Island). Lord of Atlantis's two static effects, narrowed to "you control".
// hand-tail: Other Merfolk creatures you control get +1/+1 and have islandwalk. (#10501)
export const masterOfThePearlTrident = defineCard(() => ({
    id: "e7decbd3-c754-451c-8d63-4f31f81412d2",
    rarity: "rare",
    name: "Master of the Pearl Trident",
    oracleText:
        "Other Merfolk creatures you control get +1/+1 and have islandwalk. (They can't be blocked as long as defending player controls an Island.)",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                ctx.hasSubtype(target, "Merfolk"),
            power: 1,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                ctx.hasSubtype(target, "Merfolk"),
            keyword: "islandwalk",
        },
    ],
}));
