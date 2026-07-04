// FIC — red cards, split by colour per ADR 0043. The registry's
// `import * as fic from "./sets/fic"` resolves through fic/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — "Rage" here is an uncensused ability word (no
// mechanicsRegistry row) for "whenever Gau attacks, put a +1/+1 counter on
// it" — that half alone would be DSL-buildable, but the card's actual
// removal-adjacent payoff ("if a card left your graveyard this turn, Gau
// deals damage to each opponent") needs a "did a zone-change event of this
// kind happen this turn" tracker that doesn't exist. Stop-and-issue per
// gre-development.md; tracked stub.
// export const gauFeralYouth: CardDefinition = {
//     id: "89175ce1-0746-4ba1-970e-617d134b0527",
//     name: "Gau, Feral Youth",
//     rarity: "rare",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Human", "Berserker"],
//     power: 2,
//     toughness: 2,
// };

export {};
