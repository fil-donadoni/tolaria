// BIG — black cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — two independent gaps: (1) "OTHER creatures get
// -2/-2" needs a forEach battlefield selector that can exclude the source
// permanent — `EffectForEachSelector`'s `filter` is type/subtype only, no
// exclude-self/exclude-instance-id; (2) the alternative activated ability is
// cast BY DISCARDING THIS CARD FROM HAND — `ActivatedAbility.cost` has no
// "discard this card from hand as the activation cost" shape (only
// discardLastDrawn / discardAtRandom, neither of which is "this card").
// Stop-and-issue per gre-development.md; tracked stub.
// export const harvesterOfMisery: CardDefinition = {
//     id: "a3012af9-621d-4fae-b00d-079a89ae35fe",
//     name: "Harvester of Misery",
//     rarity: "mythic",
//     manaCost: { X: 3, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Spirit"],
//     power: 5,
//     toughness: 4,
// };

export {};
