// TMP — red cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Goblin Bombardment — "Sacrifice a creature: This enchantment deals 1
// damage to any target." (CR 701.16 sacrifice cost, CR 120.1 damage.) The
// sacrificed creature is any creature the activating player controls (not
// necessarily this permanent, since Goblin Bombardment is an Enchantment,
// not a creature) — `cost.sacrificeFilter` needs no `excludeInstanceIds`
// (this permanent isn't itself a creature, so it can never satisfy its own
// filter).
export const goblinBombardment: CardDefinition = {
    id: "179e954f-1d90-4ef4-b800-25845cc338e2",
    rarity: "uncommon",
    name: "Goblin Bombardment",
    oracleText:
        "Sacrifice a creature: This enchantment deals 1 damage to any target.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "goblin-bombardment-sac",
            oracleText:
                "Sacrifice a creature: This enchantment deals 1 damage to any target.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// Mogg Fanatic — "Sacrifice this creature: It deals 1 damage to any target."
// The sacrifice-for-effect shape shared with Seal of Fire: sacrifice THIS
// source as an activation cost (CR 602.1 / 701.21) with no mana and no tap —
// activatable any time you have priority (a sacrifice ability is not a tap
// ability, so summoning sickness never gates it, CR 302.6 / 602.5b). The
// self-sacrifice is `cost.sacrifice` (distinct from Goblin Bombardment's
// `sacrificeFilter`, which sacrifices a chosen OTHER creature). DSL-first: a
// single `dealDamage` Op to the announced any-target (CR 120.1); the creature
// is removed to the graveyard at cost payment, before the ability resolves off
// its stack-item clone.
export const moggFanatic: CardDefinition = {
    id: "ca2ecfd4-c874-4468-8601-87aa110d5a00",
    rarity: "common",
    name: "Mogg Fanatic",
    oracleText: "Sacrifice this creature: It deals 1 damage to any target.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "mogg-fanatic-sac",
            oracleText:
                "Sacrifice this creature: It deals 1 damage to any target.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
