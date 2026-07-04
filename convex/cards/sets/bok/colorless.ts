// BOK — colorless cards, split by colour per ADR 0043. The registry's
// `import * as bok from "./sets/bok"` resolves through bok/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Jitte's first counter-removal mode pumps the
// EQUIPPED creature (not an announced target): the `pump` Op's
// `EffectObjectSelector` has no "the permanent this Equipment/Aura is
// attached to" selector yet — the exact gap already flagged on Holy Armor's
// activated ability (lea/white.ts: "Blocked on: an attached-object
// EffectObjectSelector, not pump"). The other two modes (target creature
// -1/-1, gain 2 life) are DSL-clean, but shipping only 2 of 3 modes would
// misrepresent the card. Stop-and-issue per gre-development.md; tracked stub.
// export const umezawasJitte: CardDefinition = {
//     id: "3b6e5956-f795-451b-bb24-56462d1ced27",
//     name: "Umezawa's Jitte",
//     rarity: "rare",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
//     subtypes: ["Equipment"],
// };

export {};
