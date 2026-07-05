// SPM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as spm from "./sets/spm"` resolves through spm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Carnage, Crimson Chaos — {2}{B}{R} Legendary Creature. "Trample. When
// Carnage enters, return target creature card with mana value 3 or less from
// your graveyard to the battlefield. It gains 'This creature attacks each
// combat if able' and 'When this creature deals combat damage to a player,
// sacrifice it.' Mayhem {B}{R}." Blocked: keyword **Mayhem** (CR 702.187) is
// `status: "planned"`; the ETB reanimation also grants the reanimated
// creature two bespoke, non-keyword rules-text abilities that have no
// `grantAbility` vocabulary entry (that Op grants NAMED registry keywords,
// not freeform text) (issue #920).
// tracked-by: #920
// export const carnageCrimsonChaos: CardDefinition = {
//     id: "930befba-6068-493e-baa2-e9371cd99e93",
//     name: "Carnage, Crimson Chaos",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Symbiote", "Villain"],
//     power: 4,
//     toughness: 3,
// };

export {};
