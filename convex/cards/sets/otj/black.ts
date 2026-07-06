// OTJ — black cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj"` resolves through otj/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Caustic Bronco — {1}{B} Creature — Snake Horse Mount, 2/2 (Vintage Cube
// edict/discard/hand disruption, issue #682). "Whenever this creature
// attacks, reveal the top card of your library and put it into your hand.
// You lose life equal to that card's mana value if this creature isn't
// saddled. Otherwise, each opponent loses that much life. Saddle 3 (...)"
// Blocked: keyword **Saddle** (CR 702.171) is `status: "planned"` in
// mechanicsRegistry.ts. The card's whole payoff (self-damage vs.
// opponent-damage) is gated on saddled status, so there is no meaningful
// partial shape to ship. See issue #931 (split from #682).
// tracked-by: #931
// export const causticBronco: CardDefinition = {
//     id: "e9a268ba-c442-4fe4-90b4-2810c8474f4e",
//     name: "Caustic Bronco",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Snake", "Horse", "Mount"],
//     power: 2,
//     toughness: 2,
// };

export {};
