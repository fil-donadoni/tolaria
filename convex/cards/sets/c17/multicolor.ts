// C17 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as c17 from "./sets/c17"` resolves through c17/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — needs `createTokenCopy` (a token that copies a
// permanent), explicitly called out as a `planned` backlog Op in this
// issue's authoring note — distinct from the shipped spec-driven
// `createToken`. Stop-and-issue per gre-development.md; tracked stub.
// export const fracturedIdentity: CardDefinition = {
//     id: "b2f73f5d-1aad-48c2-9e74-5f7bdd87900f",
//     name: "Fractured Identity",
//     rarity: "rare",
//     manaCost: { X: 3, W: 1, U: 1 },
//     types: ["Sorcery"],
// };

export {};
