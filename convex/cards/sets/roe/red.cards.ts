// ROE — red cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard, AURA_AFFECTS_HOST } from "../../types";

// Splinter Twin — {2}{R}{R} Enchantment — Aura. Enchant creature. Enchanted
// creature has "{T}: Create a token that's a copy of this creature, except it
// has haste. Exile that token at the beginning of the next end step."
// Twin combo piece with Deceiver Exarch (NPH).
export const splinterTwin = defineCard(() => ({
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
}));
