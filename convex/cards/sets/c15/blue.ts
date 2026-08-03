// C15 — blue cards, split by colour per ADR 0043. The registry's
// `import * as c15 from "./sets/c15"` resolves through c15/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Mystic Confluence — {3}{U}{U} Instant. "Choose three. You may choose the
// same mode more than once. • Counter target spell unless its controller
// pays {3}. • Return target creature to its owner's hand. • Draw a card."
// (CR 700.2 modal.) Blocked: the only modal constructs the engine has —
// Effect Script `optionChoice` and the legacy `CardDefinition.modes`
// mechanism — both pick EXACTLY ONE mode (CR 700.2b "choose one"). This
// card needs "choose three, repeats allowed" — the same cardinality shape as
// Fiery Confluence (c15/red.ts), and a strictly more general one than the
// "choose two DISTINCT modes" gap of Kolaghan's Command. All three, plus
// Flame of Anor's board-conditional count, are one construct, owned by #1566.
// Stop-and-issue per gre-development.md; tracked stub.
// tracked-by: #1566
// export const mysticConfluence: CardDefinition = {
//     id: "62e5d409-c0b6-4123-802d-eb32f223bd1a",
//     name: "Mystic Confluence",
//     rarity: "rare",
//     manaCost: { X: 3, U: 2 },
//     types: ["Instant"],
// };

export {};
