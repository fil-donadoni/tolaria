// MOC — white cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Guardian Scalelord — {4}{W} Creature. "Backup 1. Flying. Whenever this
// creature attacks, return target nonland permanent card with mana value X or
// less from your graveyard to the battlefield, where X is this creature's
// power." Backup (CR 702.165) shipped in #1315 — no longer the blocker.
// Still blocked: the attack trigger's "mana value X or less, where X is this
// creature's power" restriction needs a dynamic power-based cap on
// `EffectCardFilter.manaValueAtMost`, which today only accepts a literal or
// the spell's own `{X}` (Green Sun's Zenith) — never a source-power
// reference. Stop-and-issue per gre-development.md rather than papering over
// the gap with `resolve()`.
// tracked-by: #1378
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
