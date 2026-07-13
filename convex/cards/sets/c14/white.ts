// C14 — white cards, split by colour per ADR 0043. The registry's
// `import * as c14 from "./sets/c14"` resolves through c14/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// STOP-AND-ISSUE (tracked-by: #1148) — Containment Priest: "Flash. If a
// nontoken creature would enter and it wasn't cast, exile it instead." Flash
// (the keyword) is trivial, but the replacement clause — an
// enters-the-battlefield event keyed on a cast/not-cast origin flag — has no
// `ReplacementEventKind` in the engine (the shipped kinds are damage /
// lifegain / lifeloss / discard / lose-game / tap / destroy; none fires on a
// permanent entering the battlefield at all). Vintage Cube FREE tranche,
// issue #686. The whole card is left as one stub rather than a partial
// implementation (the replacement IS the card).
// export const containmentPriest: CardDefinition = {
//     id: "c2c794b9-09da-49be-b258-b0e21f1663e3", // C14 5
//     name: "Containment Priest",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 2,
//     toughness: 2,
// };

export {};
