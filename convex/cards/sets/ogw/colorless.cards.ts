// OGW — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ogw from "./sets/ogw/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { ManaCost } from "../../types";
import { ELDRAZI_SCION_TOKEN } from "../../sharedTokens";

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

// Warping Wail — {1}{C} Instant (OGW, issue #8645, modern-metagame).
// "Choose one — • Exile target creature with power or toughness 1 or less. •
// Counter target sorcery spell. • Create a 1/1 colorless Eldrazi Scion
// creature token. It has "Sacrifice this token: Add {C}.""
//   - A modal spell (CR 700.2) with `modeSelection` absent = exactly one; only
//     the chosen mode's target is announced (CR 601.2c).
//   - {C} in the cost is colourless mana specifically (CR 107.4c).
//   - "Power or toughness 1 or less" is `powerOrToughnessFilter` (CR 208.1,
//     CR 613.4c): one value at the bound qualifies, so the conjunctive
//     `powerFilter` / `toughnessFilter` cannot say it.
//   - Counter: `spellTypeFilter: "Sorcery"` (CR 114.1) then `counter`
//     (CR 701.6a).
//   - The Scion shares the Spawn's sacrifice mana ability (CR 605.3a).
// hand-tail: Choose one — • Exile target creature with power or toughness 1 or less. • Counter target sorcery spell. • Create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}." (#8645)
export const warpingWail = defineCard(() => ({
    id: "c8b9fa02-0a0c-4a87-9a00-3c1c7e2f4bfd",
    rarity: "uncommon",
    name: "Warping Wail",
    oracleText:
        'Choose one —\n• Exile target creature with power or toughness 1 or less.\n• Counter target sorcery spell.\n• Create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."',
    manaCost: { X: 1, C: 1 } as ManaCost,
    types: ["Instant"],
    modes: [
        {
            id: "exile-creature",
            label: "Exile target creature with power or toughness 1 or less",
            oracleText:
                "Exile target creature with power or toughness 1 or less.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerOrToughnessFilter: { max: 1 },
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
        {
            id: "counter-sorcery",
            label: "Counter target sorcery spell",
            oracleText: "Counter target sorcery spell.",
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: "Sorcery",
            },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
        {
            id: "create-scion",
            label: "Create a 1/1 Eldrazi Scion",
            oracleText:
                'Create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."',
            effects: [
                {
                    op: "createToken",
                    token: ELDRAZI_SCION_TOKEN,
                    controller: "controller",
                },
            ],
        },
    ],
}));
