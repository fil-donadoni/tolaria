// NEC — blue cards, split by colour per ADR 0043. The registry's
// `import * as nec from "./sets/nec"` resolves through nec/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Kappa Cannoneer: keywords **Improvise**
// (CR 702.126) and **Ward** (CR 702.21) are both `status: "planned"` in
// mechanicsRegistry.ts. Stop-and-issue per gre-development.md rather than
// declaring unimplemented keywords.
// export const kappaCannoneer: CardDefinition = {
//     id: "85a89077-b384-4fca-9d26-7297962c1541",
//     name: "Kappa Cannoneer",
//     rarity: "rare",
//     manaCost: { X: 5, U: 1 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Turtle", "Warrior"],
//     power: 4,
//     toughness: 4,
// };

export {};
