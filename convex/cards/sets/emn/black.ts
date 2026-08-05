// EMN — black cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn"` resolves through emn/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(stub — Escalate, CR 702.120, is `planned` in mechanicsRegistry.ts (no
// "pay this additional cost per extra mode chosen" primitive). Its other half,
// the "choose one or more" variable-size mode pick, is the `min..max` range of
// the modal cardinality grammar (PRD #2261 / #2263) — so once that lands, only
// the per-extra-mode COST is left. Stop-and-issue per gre-development.md.
// tracked-by: #2267 (Escalate cost rider), blocked by #2263
// export const collectiveBrutality: CardDefinition = {
//     id: "cb94a02f-4660-45b6-8a39-941b710cf8f3",
//     name: "Collective Brutality",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Sorcery"],
// };

export {};
