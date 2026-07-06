// ALA — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ala from "./sets/ala"` resolves through ala/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Tidehollow Sculler — {W}{B} Artifact Creature — Zombie, 2/2 (Vintage Cube
// edict/discard/hand disruption, issue #682). "When this creature enters,
// target opponent reveals their hand and you choose a nonland card from it.
// Exile that card. When this creature leaves the battlefield, return the
// exiled card to its owner's hand." Blocked: "exile [a card chosen from an
// opponent's HAND], return it to its owner's hand when THIS PERMANENT leaves
// the battlefield" has no engine primitive. The existing exile-and-return
// machinery (`exileWithAttachments` / `returnExiledForSource`,
// `gre/state.ts`, ADR 0028 — Banishing Light / Portable Hole precedent) is
// battlefield-permanent-only: it exiles FROM and returns TO the battlefield.
// Nothing tracks a hidden-zone (hand) card linked to a permanent's
// leaves-the-battlefield trigger and returns it to a HAND. See issue #931
// (split from #682).
// tracked-by: #931
// export const tidehollowSculler: CardDefinition = {
//     id: "1abecc77-07f2-43e4-8585-0a8199cdcf01",
//     name: "Tidehollow Sculler",
//     rarity: "uncommon",
//     manaCost: { W: 1, B: 1 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Zombie"],
//     power: 2,
//     toughness: 2,
// };

export {};
