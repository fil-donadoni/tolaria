// DMU — white cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu"` resolves through dmu/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Domain is an uncensused ability word: no
// mechanicsRegistry row, and `StaticCostModifier.costReduction` is a FIXED
// ManaCost, not a dynamic "1 less per basic land type you control" (0-5)
// reducer): Leyline Binding's cost is central to its playability, so a
// faithful implementation needs a variable cost-reduction primitive that
// doesn't exist yet. Its O-Ring-style "exile until this leaves the
// battlefield" ETB would be resolve()-able (Banishing Light precedent,
// jou/white.ts), but Domain blocks the whole card. Stop-and-issue per
// gre-development.md; tracked stub.
// export const leylineBinding: CardDefinition = {
//     id: "3c3ac3dd-35db-447f-8674-37b4680a1ef7",
//     name: "Leyline Binding",
//     rarity: "rare",
//     manaCost: { X: 5, W: 1 },
//     types: ["Enchantment"],
// };

// STOP-AND-ISSUE (tracked-by: #1239) — Serra Paragon: "Flying. Once during
// each of your turns, you may play a land from your graveyard or cast a
// permanent spell with mana value 3 or less from your graveyard. If you do,
// it gains \"When this permanent is put into a graveyard from the
// battlefield, exile it and you gain 2 life.\"" Issue #1149 shipped the
// BROAD, player-wide, turn-scoped graveyard-cast permission (Yawgmoth's
// Will's `grantGraveyardPlay` Op) — deliberately NOT reused here per its own
// design notes: Serra's grant is SCOPED (once/turn, land-or-MV<=3-permanent,
// choice-driven) and per-INSTANCE, not a blanket player-wide flag. Two
// capabilities still missing: (1) a scoped, once-per-turn, per-instance
// graveyard-cast/land-play grant (mirrors the existing per-instance
// `castableFromExileBy` exile-cast grant shape, not #1149's player-wide
// list), and (2) the "if you do, it gains ..." clause — a RUNTIME ability
// grant onto the SPECIFIC card played this way, conditional on it actually
// being played (not merely permitted) — a second capability on top of the
// permission itself, whose composition with `delayedTrigger`/`grantAbility`
// is an open design question (see #1239 for the full notes). Vintage Cube
// FREE tranche, issue #686. Whole card left as one stub (both clauses must
// land together).
// export const serraParagon: CardDefinition = {
//     id: "ce295f1e-fb31-4275-a5d3-8c6f29afff40",
//     name: "Serra Paragon",
//     rarity: "mythic",
//     manaCost: { X: 2, W: 2 },
//     types: ["Creature"],
//     subtypes: ["Angel"],
//     power: 3,
//     toughness: 4,
//     staticAbilities: ["flying"],
// };

export {};
