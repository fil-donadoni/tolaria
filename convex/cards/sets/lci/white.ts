// LCI — white cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Get Lost's destroy clause is DSL-clean, but its
// controller creates two Map tokens whose own activated ability is "{1},
// {T}, Sacrifice this token: target creature you control explores" — Explore,
// CR 701.44, is `planned` in mechanicsRegistry.ts, so the token would carry a
// non-functional ability text. Shipping a Map token that silently does
// nothing misrepresents the card. Stop-and-issue per gre-development.md;
// tracked stub.
// export const getLost: CardDefinition = {
//     id: "522aa72b-2b8c-484c-872b-f082101cee35",
//     name: "Get Lost",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Instant"],
// };

export {};
