// C21 — red cards, split by colour per ADR 0043. The registry's
// `import * as c21 from "./sets/c21"` resolves through c21/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Laelia, the Blade Reforged: "exile the top
// card of your library, you may play that card this turn" (impulse draw)
// has no Op — `moveZone`'s exile destination has no "grant temporary play
// permission" flag. Also blocked independently: "whenever one or more cards
// are put into exile from your library and/or graveyard" has no matching
// `GameEventType`. Stop-and-issue per gre-development.md rather than a
// `resolve()` workaround.
// export const laeliaTheBladeReforged: CardDefinition = {
//     id: "a3bb2881-e8fb-4fba-a9f9-d93e6ca24378",
//     name: "Laelia, the Blade Reforged",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Spirit", "Warrior"],
//     power: 2,
//     toughness: 2,
// };

export {};
