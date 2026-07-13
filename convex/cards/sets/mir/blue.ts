// MIR — blue cards, split by colour per ADR 0043. The registry's
// `import * as mir from "./sets/mir"` resolves through mir/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Mystical Tutor — "Search your library for an instant or sorcery card,
// reveal it, then shuffle and put that card on top." Blocked: same
// "put that card on top" gap as Vampiric Tutor — a choice-driven reorder of
// an arbitrary searched card on top of the library after a shuffle — no Op
// does this (`scryReorder`, #885, reorders only the top N; the searched card
// sits at arbitrary depth).
// tracked-by: #1125
// export const mysticalTutor: CardDefinition = {
//     id: "5d98101f-e32a-4a4a-a649-faa920d111ee",
//     name: "Mystical Tutor",
//     rarity: "uncommon",
//     manaCost: { U: 1 },
//     types: ["Instant"],
// };

export {};
