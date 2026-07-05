// LCI — blue cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Tishana's Tidebinder needs to "counter target
// activated OR triggered ability." `TargetRequirement.spellStackKind` only
// enumerates `"spell" | "activated-ability"` (used by Brown Ouphe) — there is
// no `"triggered-ability"` stack-object kind, and no counter-an-ability
// execution path exists for one either way. Countering a TRIGGERED ability
// specifically (not just activated) is a genuine engine gap, not a corner
// case — it's the more common half of this card's real usage (countering
// ETB/dies triggers). Stop-and-issue per gre-development.md; tracked stub.
// export const tishanasTidebinder: CardDefinition = {
//     id: "907b3d1d-8c85-4707-80b5-c4d832df9846",
//     name: "Tishana's Tidebinder",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Merfolk", "Wizard"],
//     power: 3,
//     toughness: 2,
// };

export {};
