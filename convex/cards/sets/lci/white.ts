// LCI — white cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — the Explore blocker is GONE: CR 701.44 shipped as
// the `explore` Effect Op and the Map token as `MAP_TOKEN_SPEC`
// (abilities/tokens/mapToken.ts) in issue #2376, which deliberately scoped
// itself to Sentinel of the Nameless City. What is left is the CARD, not the
// mechanic: verify the printed cost against Scryfall (the line below is an
// unverified stub) and author "Destroy target creature, planeswalker, or
// battle. Its controller creates two Map tokens." as `destroy` +
// `createMapTokenOp({ controllerOf: { target: 0 } }, 2)`. Tracked stub.
// export const getLost: CardDefinition = {
//     id: "522aa72b-2b8c-484c-872b-f082101cee35",
//     name: "Get Lost",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Instant"],
// };

export {};
