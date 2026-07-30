// SPM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as spm from "./sets/spm"` resolves through spm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Carnage, Crimson Chaos — {2}{B}{R} Legendary Creature. "Trample. When
// Carnage enters, return target creature card with mana value 3 or less from
// your graveyard to the battlefield. It gains 'This creature attacks each
// combat if able' and 'When this creature deals combat damage to a player,
// sacrifice it.' Mayhem {B}{R}." Blocked, HALF-narrowed: `grantAbility`
// widened (issue #1665 — `grantedTriggeredId` + `triggeredGrantTemplates[]`)
// to grant non-keyword TRIGGERED abilities, proven by Guardian Scalelord
// (`moc/white.ts`), so "when this creature deals combat damage to a player,
// sacrifice it" is now expressible. What remains: (i) keyword **Mayhem**
// (CR 702.187) is still `status: "planned"` (`convex/cards/mechanicsRegistry.ts`)
// → tracked-by #1971, and (ii) "attacks each combat if able" is NOT
// grantable per-instance — `hasAttackRequirement` (`convex/gre/combat.ts`)
// reads `attack-requirement` only from the card's own compile-time
// `def.staticEffects`; the only per-instance flag, `mustAttackThisTurn`
// (`convex/gre/state.ts`), is transient and cleared at cleanup — the wrong
// duration for a permanent grant → tracked-by #1972.
// tracked-by: #1971
// tracked-by: #1972
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
