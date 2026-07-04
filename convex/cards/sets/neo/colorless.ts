// NEO — colorless cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Channel is an uncensused ability word (no
// mechanicsRegistry row) for "discard this card: <effect>" as an
// alternative way to use a card from hand; separately, the channel effect
// itself needs a "nonbasic land" target filter (`TargetRequirement` has no
// exclude-supertype field, only the positive `supertypeFilter`) and the
// land-search tail. Stop-and-issue per gre-development.md; tracked stub.
// export const boseijuWhoEndures: CardDefinition = {
//     id: "2135ac5a-187b-4dc9-8f82-34e8d1603416",
//     name: "Boseiju, Who Endures",
//     rarity: "rare",
//     types: ["Land"],
//     supertypes: ["Legendary"],
// };

export {};
