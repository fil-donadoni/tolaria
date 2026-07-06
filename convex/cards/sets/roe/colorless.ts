// ROE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #684 stub — Emrakul, the Aeons Torn is blocked on THREE
// separate uncensused capabilities, any one of which would already
// disqualify it from this "evasion/protection statics" FREE tranche:
//  1. "When you cast this spell, take an extra turn after this one." — no
//     `extraTurn`-shaped EffectOp exists; the only engine primitive
//     (`SpellContext.takeExtraTurn`, gre/state.ts) is consumed exclusively
//     via `resolve()` today (lea/blue.ts Time Walk) and isn't in
//     EFFECT_OP_REGISTRY.
//  2. "Annihilator 6" (CR 702.86) is `status: "planned"` in
//     mechanicsRegistry.ts with NO `bindingPattern` for the numbered form —
//     `isNamedMechanic("annihilator 6")` doesn't match the bare "Annihilator"
//     row, and even if it did, no sacrifice-N-permanents-on-unblocked-attack
//     combat mechanic exists in combatRegistry.ts/phases.ts to back it.
//  3. "Protection from spells that are one or more colors" is a distinct
//     702.16 sub-quality (spell-only, not the standard "protection from
//     [color]" the engine's protection.ts module models) — no evidence the
//     targeting/damage/blocking checks there distinguish a spell-only
//     protection quality from the general color-source form.
// "Can't be countered" and the graveyard-shuffle LTB are individually
// tractable, but per gre-development.md ("never ship partial"), a stub-
// worthy gap on the card's signature abilities blocks the whole card.
// Stop-and-issue; tracked stub.
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
