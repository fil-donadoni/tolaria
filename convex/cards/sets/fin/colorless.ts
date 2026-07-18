// FIN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Starting Town — "This land enters tapped unless it's your first, second,
// or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of
// any color." UN-STOPPED (issue #1306, re-audit of the #675-era stub, parent
// PRD #620): the stub's original blocker — this engine's tap-mana fast path
// resolving only a card's FIRST `{T}` ability — no longer holds.
// `getManaTapOptionsDetailed` (`convex/gre/constants.ts`) now unions options
// across EVERY `activatedAbilities` entry (Urborg/Mana Battery/storage-land
// support added since #675), and `tapUntap` resolves a submitted
// `manaChoiceIndex` against that SAME unified list via `resolveManaTapChoice`,
// carrying the CHOSEN ability's own `cost.life` through
// `applyManaAbilityLifeCost`. So two independently-activatable `{T}`
// abilities with DIFFERENT costs is exactly what the engine already supports
// — no per-manaChoice-conditional-cost primitive needed after all: the free
// `{T}: Add {C}` and the `{T}, Pay 1 life: Add one mana of any color` are
// simply two separate `activatedAbilities` entries, each carrying its own
// cost. `entersTappedUnless` reads `LandEntryStateView.turn` directly — a
// field whose doc comment (`cards/types.ts`) was already written FOR this
// exact clause ("Starting Town's 'first, second, or third turn of the game'
// reads it directly").
export const startingTown: CardDefinition = {
    id: "fc7d1912-7e27-49ef-bd98-375d975a42b0",
    name: "Starting Town",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color.",
    types: ["Land"],
    subtypes: ["Town"],
    // CR 614.1c self-conditional replacement — turn 1/2/3 of the game (CR
    // 103.2a numbering: turn 1 = player one's first turn, turn 2 = player
    // two's first turn, turn 3 = player one's second turn — matches "your
    // first, second, or third turn" for a 2-player/solo game).
    entersTappedUnless: (view) => view.turn <= 3,
    activatedAbilities: [
        {
            id: "starting-town-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "starting-town-any-color",
            oracleText: "{T}, Pay 1 life: Add one mana of any color.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
