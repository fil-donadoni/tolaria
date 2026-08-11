// ROE — red cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";

// Flame Slash — "Flame Slash deals 4 damage to target creature." (CR 120.1
// damage.)
export const flameSlash: CardDefinition = {
    id: "006d2bf1-20f7-4b09-8d98-8233d91682bd",
    rarity: "common",
    name: "Flame Slash",
    oracleText: "Flame Slash deals 4 damage to target creature.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
};

// Splinter Twin — {2}{R}{R} Enchantment — Aura. Enchant creature. Enchanted
// creature has "{T}: Create a token that's a copy of this creature, except it
// has haste. Exile that token at the beginning of the next end step."
// Twin combo piece with Deceiver Exarch (NPH).
export const splinterTwin: CardDefinition = {
    id: "2f8f22fb-7291-4517-9b15-e98501f2856b",
    rarity: "rare",
    name: "Splinter Twin",
    oracleText:
        'Enchant creature\nEnchanted creature has "{T}: Create a token that\'s a copy of this creature, except it has haste. Exile that token at the beginning of the next end step."',
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "splinter-twin-copy",
        },
    ],
    grantTemplates: [
        {
            id: "splinter-twin-copy",
            oracleText:
                "{T}: Create a token that's a copy of this creature, except it has haste. Exile that token at the beginning of the next end step.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "createTokenCopy",
                    source: { ref: "$source" },
                    controller: "controller",
                    bind: "$copy",
                },
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$copy" },
                        filter: { type: "Creature" },
                    },
                    then: [
                        {
                            op: "grantAbility",
                            ability: "haste",
                            target: { ref: "$copy" },
                        },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "At the beginning of the next end step, exile that token.",
                            capture: { $token: { ref: "$copy" } },
                            effects: [
                                {
                                    op: "exile",
                                    target: { ref: "$token" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};
