// PTK — black cards, split by colour per ADR 0043. The registry's
// `import * as ptk from "./sets/ptk"` resolves through ptk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Imperial Seal — "Search your library for a card, then shuffle and put
// that card on top. You lose 2 life." Blocked: same "put that card on top"
// gap as Vampiric Tutor / Mystical Tutor — no Op places an arbitrary
// searched card on top of a library after a shuffle (`scryReorder`, #885,
// reorders only the top N; the searched card sits at arbitrary depth).
// tracked-by: #1125
// export const imperialSeal: CardDefinition = {
//     id: "822e30db-40c5-4099-868b-185ad9b7c7dc",
//     name: "Imperial Seal",
//     rarity: "rare",
//     manaCost: { B: 1 },
//     types: ["Sorcery"],
// };

export {};
