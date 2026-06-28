// MKM — blue cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm"` resolves through mkm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(needs-triage): implement — needs a new engine capability.
// tracked-by: #674
// export const forensicGadgeteer: CardDefinition = {
//     id: "97d08a15-e61c-4421-a541-c68a4f87cb74",
//     name: "Forensic Gadgeteer",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Vedalken", "Artificer", "Detective"],
//     power: 2,
//     toughness: 3,
// };

// TODO(needs-triage): implement — needs a new engine capability.
// tracked-by: #674
// export const proftsEideticMemory: CardDefinition = {
//     id: "af5b29b3-974c-4200-8df8-b072c11e1600",
//     name: "Proft's Eidetic Memory",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
//     supertypes: ["Legendary"],
// };

export {};
