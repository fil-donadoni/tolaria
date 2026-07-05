// PTK — black cards, split by colour per ADR 0043. The registry's
// `import * as ptk from "./sets/ptk"` resolves through ptk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Imperial Seal — "Search your library for a card, then shuffle and put
// that card on top. You lose 2 life." Blocked: same "put that card on top"
// gap as Vampiric Tutor / Mystical Tutor — deferred to the `scryReorder`
// backlog Op (mechanicsRegistry.ts, issue #885).
// tracked-by: #885
// export const imperialSeal: CardDefinition = {
//     id: "822e30db-40c5-4099-868b-185ad9b7c7dc",
//     name: "Imperial Seal",
//     rarity: "rare",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

export {};
