// kld — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

// Chandra, Torch of Defiance — {2}{R}{R} Legendary Planeswalker — Chandra,
// loyalty 4. BLOCKED on the cast-during-resolution (cascade) subsystem.
//
// The loyalty framework (ADR 0058, #700) covers the costs, and three of the
// four abilities are expressible today:
//   +1: Add {R}{R}.                              → addMana Op (#850)
//   −3: Chandra deals 4 damage to target creature. → dealDamage Op
//   −7: emblem "Whenever you cast a spell, this emblem deals 5 damage to any
//       target."                                  → emblem Op + a triggered
//       EmblemDefinition (#1221; scanner wired at triggers.ts:287)
//
// The blocking clause is the OTHER +1: "Exile the top card of your library.
// You may cast that card. If you don't, Chandra deals 2 damage to each
// opponent." Per the official ruling the exiled card is cast AS PART OF
// RESOLVING the ability (cascade-like, timing ignored); declining / being
// unable to pay leaves it exiled and triggers the reflexive 2 damage. The
// engine has no mid-resolution cast path — `grantCastFromExile` only stamps an
// until-turn permission for a later player-initiated cast, and cascade is
// `status: "planned"` in mechanicsRegistry.ts. This is NOT the until-EOT
// impulse of #791; modeling it that way would diverge from the CR ruling and
// leave the "if you don't" clause with no clean home. Do not invent a name or
// paper over the gap with `resolve()`.
// tracked-by: #1252
// export const chandraTorchOfDefiance: CardDefinition = {
//     id: "ff8086cd-b868-4f4e-823e-2635ad7ebc07",
//     name: "Chandra, Torch of Defiance",
//     rarity: "mythic",
//     oracleText:
//         "+1: Exile the top card of your library. You may cast that card. If you don't, Chandra deals 2 damage to each opponent.\n+1: Add {R}{R}.\n−3: Chandra deals 4 damage to target creature.\n−7: You get an emblem with \"Whenever you cast a spell, this emblem deals 5 damage to any target.\"",
//     manaCost: { X: 2, R: 2 },
//     types: ["Planeswalker"],
//     supertypes: ["Legendary"],
//     subtypes: ["Chandra"],
//     loyalty: 4,
// };

export {};
