// ROE — green cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Vengevine — {2}{G}{G} Creature. "Haste. Whenever you cast a spell, if it's
// the second creature spell you cast this turn, you may return this card
// from your graveyard to the battlefield." (CR 603.6e graveyard-zone
// triggered ability, CR 117.3a optional "may".) Blocked: "if it's the second
// creature spell you cast this turn" needs a per-turn "creature spells cast"
// counter exposed to a `TriggeredAbility.matches`/`state` predicate; no such
// tracking exists yet (`GameState` has no per-turn spell-cast-kind counter)
// (issue #920).
// tracked-by: #1968
// export const vengevine: CardDefinition = {
//     id: "51eb9f05-9d5a-4196-9329-626ce4793c42",
//     name: "Vengevine",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 2 },
//     types: ["Creature"],
//     subtypes: ["Elemental"],
//     power: 4,
//     toughness: 3,
// };

export {};
