// RTR — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as rtr from "./sets/rtr"` resolves through rtr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, ManaCost } from "../../types";
import { colorChoiceModes } from "../../abilities/chooseColor";

// Deathrite Shaman — {B/G} Creature — Elf Shaman, 1/2 (issue #1926, PRD
// #1736 hybrid mana wave). Printed cost is a single GUILD-HYBRID pip,
// declared via `manaCost.hybrid` (issue #1338) and payable with mana off
// either colour of land (issues #1738/#1739, landed #1755) — see Figure of
// Destiny (eve/multicolor.ts) for the reference shape. This unblocks the
// stub previously tracked at #782 (closed).
//
// Current Oracle text (Ravnica Remastered — modern wording, no printed-era
// "if it was a basic land card" clause):
//   "{T}: Exile target land card from a graveyard. Add one mana of any
//    color.
//    {B}, {T}: Exile target instant or sorcery card from a graveyard. Each
//    opponent loses 2 life.
//    {G}, {T}: Exile target creature card from a graveyard. You gain 2
//    life."
//
// CR 605.1a — NONE of the three abilities are mana abilities, despite the
// first one adding mana: a mana ability may not require a target (CR
// 605.1a), and all three name a target ("target land/instant or sorcery/
// creature card from a graveyard"). This is a real, official ruling (WotC,
// 2016-06-08: "Because the first ability requires a target, it is not a
// mana ability. It uses the stack and can be responded to."), not a
// simplification — all three abilities are ordinary `useStack: true` (tracked-by: #2785)
// activated abilities. `zone: "graveyard", controller: "any"` targets a
// card in ANY player's graveyard (CR 400.7), matching "a graveyard" (not
// "your graveyard") in the Oracle text — same shape as Grave Robbers / Eater
// of the Dead (drk/black.ts).
//
// The runtime "add one mana of any color" choice has no dedicated Op
// (`addMana`'s own Mechanics Registry note scopes out a runtime colour
// choice) — the established composition for a `useStack: true` ability
// (`manaChoices`/`effect` is reserved for `useStack: false` mana abilities
// only, per `ActivatedAbility.effect`'s own doc) is a 5-mode `optionChoice`,
// each mode a bare `addMana` for that colour, exactly as Phyrexian Altar
// (inv/colorless.ts) already ships — both Ops already exercised
// catalogue-wide (per-Op regime, no hand-written test required).
export const deathriteShaman: CardDefinition = {
    id: "70496f16-c4c0-4c03-beef-454eb4824cd1",
    rarity: "rare",
    name: "Deathrite Shaman",
    oracleText:
        "{T}: Exile target land card from a graveyard. Add one mana of any color.\n{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.\n{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.",
    manaCost: { hybrid: [["B", "G"]] },
    types: ["Creature"],
    subtypes: ["Elf", "Shaman"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "deathrite-shaman-land-mana",
            oracleText:
                "{T}: Exile target land card from a graveyard. Add one mana of any color.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                {
                    op: "optionChoice",
                    player: "controller",
                    prompt: "Choose a color.",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "addMana",
                            mana: { [color]: 1 } as ManaCost,
                        },
                    ]),
                },
            ],
        },
        {
            id: "deathrite-shaman-graveyard-hate",
            oracleText:
                "{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.",
            cost: { tap: true, mana: { B: 1 } },
            useStack: true,
            targetRequirement: {
                type: ["Instant", "Sorcery"],
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "loseLife", player: "opponent", amount: 2 },
            ],
        },
        {
            id: "deathrite-shaman-lifegain",
            oracleText:
                "{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.",
            cost: { tap: true, mana: { G: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
    ],
};
