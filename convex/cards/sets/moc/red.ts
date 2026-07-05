// MOC — red cards, split by colour per ADR 0043. The registry's
// `import * as moc from "./sets/moc"` resolves through moc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Death-Greeter's Champion: keywords
// **Dash** (CR 702.109) and **Backup** (CR 702.165) are both
// `status: "planned"` in mechanicsRegistry.ts. Stop-and-issue per
// gre-development.md rather than declaring unimplemented keywords.
// export const deathGreetersChampion: CardDefinition = {
//     id: "7cb2b582-1c45-4bb2-8aef-59a71a5a9e94",
//     name: "Death-Greeter's Champion",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Warrior"],
//     power: 2,
//     toughness: 1,
// };

export {};
