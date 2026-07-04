// ECL — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — two independent gaps: (1) Evoke, CR 702.74, is
// `planned` in mechanicsRegistry.ts (no alternative-cost-then-sacrifice-on-
// ETB primitive); (2) both ETB triggers are conditional on WHICH colour of
// hybrid mana was spent to cast the spell ("if {G}{G} was spent" / "if
// {U}{U} was spent") — `noteManaSpent` records an amount, but there's no
// Effect Script predicate reading it, and the interpreter has no per-colour-
// spent branch form. Stop-and-issue per gre-development.md; tracked stub.
// export const wistfulness: CardDefinition = {
//     id: "db9aa986-ac2a-44bb-a88b-04c5d0d502b2",
//     name: "Wistfulness",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 6,
//     toughness: 5,
// };

export {};
