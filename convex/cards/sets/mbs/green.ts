// MBS — green cards, split by colour per ADR 0043. The registry's
// `import * as mbs from "./sets/mbs"` resolves through mbs/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Green Sun's Zenith — "Search your library for a green creature card with
// mana value X or less, put it onto the battlefield, then shuffle. Shuffle
// Green Sun's Zenith into its owner's library." Blocked on two gaps: (1) a
// DYNAMIC mana-value ceiling ("X or less") — issue #677's
// `EffectCardFilter.manaValueAtMost` is a FIXED literal only (Spellseeker's
// "2 or less"), not an `EffectValue` that could read `{ X: true }`; (2)
// "shuffle [itself] into its owner's library" replaces the NORMAL
// resolved-spell-to-graveyard placement (CR 608.2m) — no primitive models
// this self-redirect. Not a `resolve()` card — both are missing-capability
// stop-and-issue cases.
// tracked-by: #898
// export const greenSunsZenith: CardDefinition = {
//     id: "02335747-54e3-4827-ae19-4e362863da9b",
//     name: "Green Sun's Zenith",
//     rarity: "rare",
//     manaCost: { X: "X", G: 1 },
//     types: ["Sorcery"],
// };

export {};
