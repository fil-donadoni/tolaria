// ROE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// tracked-by: #1301 — Emrakul, the Aeons Torn is blocked on uncensused
// capabilities on its signature abilities. Prior tracker #684 (Cube FREE
// tranche) is CLOSED and never covered this card; #1301 is the live tracker.
//  1. "Annihilator 6" (CR 702.86) — SHIPPED by #2295. The registry row is
//     `implemented` with a `/^annihilator \d+$/` bindingPattern, and
//     `expandAnnihilator` (convex/cards/abilities/annihilator.ts) injects the
//     CR 702.86a attack trigger from the bare `staticAbilities` string. No
//     longer a blocker for this card.
//  2. "Protection from spells that are one or more colors" is a distinct
//     702.16 sub-quality (spell-only, not the standard "protection from
//     [color]" the engine's protection.ts module models) — no evidence the
//     targeting/damage/blocking checks there distinguish a spell-only
//     protection quality from the general color-source form.
//  3. "When you cast this spell, take an extra turn after this one." — a
//     cast-trigger site. Now the SMALLEST gap: the `extraTurn` EffectOp is
//     `implemented` (shipped w/ Time Warp #686) and cast-trigger infra
//     shipped w/ Storm (ADR 0052); wire the Op to a cast-trigger.
// "Can't be countered" and the graveyard-shuffle LTB are individually
// tractable, but per gre-development.md ("never ship partial"), a stub-
// worthy gap on the card's signature abilities (Annihilator) blocks the
// whole card. Stop-and-issue; tracked stub.
// export const emrakulTheAeonsTorn: CardDefinition = {
//     id: "67600383-bbb8-411c-b8e6-2296650bc747",
//     name: "Emrakul, the Aeons Torn",
//     rarity: "mythic",
//     manaCost: { X: 15 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Eldrazi"],
//     power: 15,
//     toughness: 15,
// };

export {};
