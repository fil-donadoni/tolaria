// OGW — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ogw from "./sets/ogw/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { ManaCost } from "../../types";

// Mirrorpool — Land (OGW, issue #8856, modern-metagame). "This land enters
// tapped. {T}: Add {C}. {2}{C}, {T}, Sacrifice this land: Copy target instant
// or sorcery spell you control. You may choose new targets for the copy.
// {4}{C}, {T}, Sacrifice this land: Create a token that's a copy of target
// creature you control."
//   - Both costs name {C} — colourless mana specifically (CR 107.4c), which a
//     coloured or generic payment cannot satisfy.
//   - The first ability is the shape the compiler emits for Nivix Guildmage:
//     `copySpell` over an announced instant/sorcery spell slot (CR 707.10,
//     707.10c).
//   - The second announces a creature you control and copies it as a token
//     (CR 707.2, 111.1): `createTokenCopy` over that slot. If the creature
//     left the battlefield the Op skips (CR 608.2b); the land is already
//     sacrificed as a cost (CR 602.2b).
// hand-tail: {4}{C}, {T}, Sacrifice this land: Create a token that's a copy of target creature you control. (#8856)
export const mirrorpool = defineCard(() => ({
    id: "edbea2b5-eed3-464b-9d5c-9591f309f298",
    name: "Mirrorpool",
    rarity: "mythic",
    oracleText:
        "This land enters tapped.\n{T}: Add {C}.\n{2}{C}, {T}, Sacrifice this land: Copy target instant or sorcery spell you control. You may choose new targets for the copy.\n{4}{C}, {T}, Sacrifice this land: Create a token that's a copy of target creature you control.",
    manaCost: { X: 0 },
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "mirrorpool-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 } as ManaCost,
        },
        {
            id: "mirrorpool-ability-2",
            oracleText:
                "{2}{C}, {T}, Sacrifice this land: Copy target instant or sorcery spell you control. You may choose new targets for the copy.",
            cost: { mana: { X: 2, C: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: ["Instant", "Sorcery"],
                controller: "you",
            },
            effects: [
                { op: "copySpell", target: { target: 0 }, newTargets: true },
            ],
        },
        {
            id: "mirrorpool-ability-3",
            oracleText:
                "{4}{C}, {T}, Sacrifice this land: Create a token that's a copy of target creature you control.",
            cost: { mana: { X: 4, C: 1 }, tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "createTokenCopy",
                    source: { target: 0 },
                    controller: "controller",
                },
            ],
        },
    ],
}));
