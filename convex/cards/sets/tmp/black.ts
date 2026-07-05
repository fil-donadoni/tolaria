// TMP — black cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Reanimate — {B} Sorcery. "Put target creature card from a graveyard onto
// the battlefield under your control. You lose life equal to that card's
// mana value." (CR 601.2c target in ANY graveyard, CR 400.7 / 800.4a control
// override, CR 119.3b life loss, CR 202.3 mana value.)
//
// A plain spell target (`targetRequirement.zone: "graveyard", controller:
// "any"` — Hymn of Rebirth precedent), so the pick itself needs no new
// capability. Two small, well-precedented `moveZone` generalizations (issue
// #680) express the rest with zero new Ops: `controller` (an explicit
// override of the default owner-control, passing through to
// `SpellContext.returnToBattlefield`'s already-existing optional 4th
// argument — the exact mechanism Hymn of Rebirth's `resolve()` already
// used) for "under your control", and `bind` + a `ref.manaValue` snapshot
// property for "lose life equal to that card's mana value" (captured BEFORE
// the reanimation, CR 608.2h last-known information).
export const reanimate: CardDefinition = {
    id: "ae1ef31c-8ca5-444c-8f39-e1d1827318f5",
    name: "Reanimate",
    rarity: "uncommon",
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            controller: "controller",
            bind: "$reanimated",
        },
        {
            op: "loseLife",
            player: "controller",
            amount: { ref: "$reanimated.manaValue" },
        },
    ],
};
