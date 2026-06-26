// Weatherlight (WTH) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as wth from "./sets/wth"`
// resolves through wth/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n` (e.g. {2} → { X: 2 }).
import type { CardDefinition, SpellContext } from "../../types";

// Mind Stone — {2} Artifact. A mana rock that can be cashed in for a card late
// (CR 605.1a mana ability resolves immediately; CR 605 activated draw goes on
// the stack).
export const mindStone: CardDefinition = {
    id: "162e81d3-6cd4-4cb8-8ed8-cfbd8d34ca71",
    name: "Mind Stone",
    rarity: "uncommon",
    oracleText:
        "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mind-stone-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
        },
        {
            id: "mind-stone-draw",
            oracleText: "{1}, {T}, Sacrifice this artifact: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};
