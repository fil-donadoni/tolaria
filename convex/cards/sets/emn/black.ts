// EMN — black cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn"` resolves through emn/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Escalate, CR 702.129, is `planned` in
// mechanicsRegistry.ts (no "pay this additional cost per extra mode chosen"
// primitive), and "choose one or more" is a variable-size subset pick that
// neither `optionChoice` (single fixed pick) nor `mayPay` covers. Stop-and-
// issue per gre-development.md; tracked stub.
// export const collectiveBrutality: CardDefinition = {
//     id: "cb94a02f-4660-45b6-8a39-941b710cf8f3",
//     name: "Collective Brutality",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Sorcery"],
// };

export {};
