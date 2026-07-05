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

// Necromancy — {2}{B} Enchantment. "You may cast this spell as though it had
// flash. If you cast it any time a sorcery couldn't have been cast, the
// controller of the permanent it becomes sacrifices it at the beginning of
// the next cleanup step. When this enchantment enters, if it's on the
// battlefield, it becomes an Aura with 'enchant creature put onto the
// battlefield with Necromancy.' Put target creature card from a graveyard
// onto the battlefield under your control and attach this enchantment to it.
// When this enchantment leaves the battlefield, that creature's controller
// sacrifices it." (CR 400.7 reanimation.) Blocked: "becomes an Aura enchanting
// the creature it just reanimated, sacrificed by that creature's controller
// when the Aura leaves" is a self-transform-and-dynamic-attach pattern with no
// Op — nothing lets a resolving permanent retarget itself to attach to an
// object the SAME resolution just chose (issue #920).
// tracked-by: #920
// export const necromancy: CardDefinition = {
//     id: "311a6257-dd77-4bb6-81cb-c8e7862350f3",
//     name: "Necromancy",
//     rarity: "uncommon",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };

export {};
