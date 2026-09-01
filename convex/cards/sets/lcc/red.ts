// LCC — red cards, split by colour per ADR 0043. The registry's
// `import * as lcc from "./sets/lcc"` resolves through lcc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { boastAbility } from "../../abilities/boast";

// Broadside Bombardiers — the card that surfaced Boast (CR 702.142, issue
// #2375). Its removal ability is a boast ability, so the keyword's whole
// activation-timing rule ships with it: `boastAbility()`
// (convex/cards/abilities/boast.ts) expands "Boast — [Cost]: [Effect]" into
// the two clauses CR 702.142a dictates — `requiresAttackedThisTurn: true` and
// `oncePerTurn: true` — plus the CR 702.142b `boast: true` marker.
//
// The damage amount is "2 plus the sacrificed permanent's mana value". The
// victim is in the graveyard before the ability is ever on the stack (the
// sacrifice is an additional COST, CR 601.2f), so the amount is LAST KNOWN
// INFORMATION (CR 608.2h) read off the stack item's
// `additionalSacrificeSnapshot` via the `sacrificed` EffectValue member —
// NOT a live-battlefield `manaValue` selector, which could never reach it.
export const broadsideBombardiers: CardDefinition = {
    id: "ec9df172-9fdb-4b0c-a23a-865b83c8fa40",
    name: "Broadside Bombardiers",
    rarity: "rare",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Pirate"],
    power: 2,
    toughness: 2,
    oracleText:
        "Menace, haste\nBoast — Sacrifice another creature or artifact: This creature deals damage equal to 2 plus the sacrificed permanent's mana value to any target. (Activate only if this creature attacked this turn and only once each turn.)",
    staticAbilities: ["menace", "haste"],
    activatedAbilities: [
        boastAbility({
            id: "broadside-bombardiers-boast-damage",
            oracleText:
                "Boast — Sacrifice another creature or artifact: This creature deals damage equal to 2 plus the sacrificed permanent's mana value to any target. (Activate only if this creature attacked this turn and only once each turn.)",
            // CR 109.2 — "another creature or artifact": any creature OR
            // artifact the activator controls EXCEPT this permanent.
            cost: {
                sacrificeFilter: {
                    types: ["Creature", "Artifact"],
                    excludeSource: true,
                },
            },
            useStack: true,
            // CR 115.4 — "any target": creature, player or planeswalker.
            targetRequirement: { type: "any", count: 1 },
            effects: [
                {
                    op: "dealDamage",
                    // CR 608.2h — the sacrificed permanent's mana value as last
                    // known information, plus the printed 2.
                    amount: { sacrificed: { read: "manaValue", plus: 2 } },
                    to: { target: 0 },
                },
            ],
        }),
    ],
};
