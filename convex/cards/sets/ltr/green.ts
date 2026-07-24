// LTR — green cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Delighted Halfling — "{T}: Add {C}.\n{T}: Add one mana of any color. Spend
// this mana only to cast a legendary spell, and that spell can't be
// countered." STOP-AND-ISSUE, re-audited and re-confirmed by issue #1530
// (tracked-by: #1559 — supersedes the stale #675 reference, which never
// analyzed this card specifically): the {C} ability is trivial, but the
// second ability needs TWO capabilities this engine doesn't have —
// (1) `ManaRestriction` (`convex/gre/types.ts`) only has `creature-spell` /
// `artifact-spell` / `cumulative-upkeep` variants, keyed off a spell's card
// TYPES; a `legendary-spell` variant would need to key off the SUPERTYPE
// "Legendary" instead, which `restrictionAllowsSpell`'s `spellTypes: readonly
// string[]` parameter doesn't carry today; and (2) "that spell can't be
// countered" has no existing rider on spent restricted mana at all — no
// primitive makes a spell paid for with specific mana uncounterable
// (`counter()` in `gre/state.ts` only reads the STATIC per-definition
// `cantBeCountered`, never a per-cast/per-payment dynamic flag). Left as a
// tracked stub pending both — see #1559 for the concrete engine-change plan.
// export const delightedHalfling: CardDefinition = {
//     id: "71384418-173a-4f77-adab-56e52fa23692",
//     name: "Delighted Halfling",
//     rarity: "rare",
//     manaCost: { G: 1 },
//     types: ["Creature"],
//     subtypes: ["Halfling", "Citizen"],
//     power: 1,
//     toughness: 2,
// };

// Generous Ent — "Reach. When this creature enters, create a Food token.
// Forestcycling {1} ({1}, Discard this card: Search your library for a
// Forest card, reveal it, put it into your hand, then shuffle.)" Blocked:
// Forestcycling (CR 702.29, a `[Subtype]cycling` variant) is `status:
// "planned"` in mechanicsRegistry.ts (tracked-by #689) — no cycling special
// action exists yet. Kept as a whole-card stub rather than a partial ship.
// tracked-by: #689
// export const generousEnt: CardDefinition = {
//     id: "85d22d5d-3875-42ff-b51e-c6e21db201f5",
//     name: "Generous Ent",
//     rarity: "common",
//     manaCost: { X: 5, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Treefolk"],
//     power: 5,
//     toughness: 7,
// };

export {};
