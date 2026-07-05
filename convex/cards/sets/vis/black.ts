// VIS — black cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Vampiric Tutor — "Search your library for a card, then shuffle and put
// that card on top. You lose 2 life." Blocked: "put that card on top"
// requires reordering the top of the library AFTER a shuffle — the
// `reorderLibraryTop` / `peekLibraryTop` primitives stay a `planned`
// backlog Op (`scryReorder`, mechanicsRegistry.ts) until a choice-driven
// reorder construct exists (issue #677's own authoring note). NOT a
// `resolve()` card: "the Op doesn't exist yet" is the stop-and-issue case,
// not the escape hatch.
// tracked-by: #885
// export const vampiricTutor: CardDefinition = {
//     id: "0a07cba3-2e8d-48ec-a6f8-4d2edfcd833d",
//     name: "Vampiric Tutor",
//     rarity: "rare",
//     manaCost: { B: 1 },
//     types: ["Instant"],
// };

export {};
