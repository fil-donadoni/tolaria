// MOC — white cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Guardian Scalelord — {4}{W} Creature. "Backup 1. Flying. Whenever this
// creature attacks, return target nonland permanent card with mana value X or
// less from your graveyard to the battlefield, where X is this creature's
// power." Blocked: keyword **Backup** (CR 702.165) is `status: "planned"` —
// already tracked by #917 (Death-Greeter's Champion needs the same keyword).
// tracked-by: #917
// export const guardianScalelord: CardDefinition = {
//     id: "94716d24-e8c6-4cd2-a3ac-20cdb929bfd4",
//     name: "Guardian Scalelord",
//     rarity: "rare",
//     manaCost: { X: 4, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Dragon"],
//     power: 3,
//     toughness: 4,
// };

export {};
