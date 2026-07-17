// FIN — green cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — mill is `planned` (part of the `scryReorder`
// backlog Op): no primitive puts a specific COUNT of library-top cards
// straight into the graveyard as a keyword action. Re-audited under the
// #1305 residue tranche (parent PRD #620, 2026-07-18): `mill` has since
// shipped (issue #885) and the "mill 4, may put a land to hand" half is now
// a clean `digToHand` call, but the card's THIRD clause — "If you put a
// Town card into your hand this way, you gain 2 life" — needs a predicate
// that tests a bound object's SUBTYPE (`EffectPredicate` has no
// filter-match member; a `forEach`/`digToHand` `bind` can't be re-checked
// against `EffectCardFilter`). Never ship a silent partial (CLAUDE.md) —
// the whole card stays a stub. Stop-and-issue per gre-development.md;
// tracked-by: #1363.
// export const townGreeter: CardDefinition = {
//     id: "49cd4efa-4df4-4257-9a42-60330f7781e2",
//     name: "Town Greeter",
//     rarity: "common",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Citizen"],
//     power: 1,
//     toughness: 1,
// };

export {};
