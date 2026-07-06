// vow — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

// Voldaren Epicure — {R} Creature — Vampire. "When this creature enters, it
// deals 1 damage to each opponent. Create a Blood token. (It's an artifact
// with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")" (CR
// 120.1 damage-each-opponent — already shipped, `dealDamage`/`to: {player:
// "opponent"}`; CR 111 token creation.) BLOCKED: the Blood token's identity
// IS its activated ability — `TokenSpec`/`EffectTokenSpec` (both the
// `resolve()` primitive and the `createToken` Op) have no field for a
// token-scoped `activatedAbilities[]`; only keyword `staticAbilities[]` and
// continuous `staticEffects[]` are carried. Shipping the ETB damage +
// creating an ability-less "Blood" token would misrepresent the card (the
// token would be permanently inert). Do not invent a name or paper over the
// gap with `resolve()`.
// tracked-by: #778
// export const voldarenEpicure: CardDefinition = {
//     id: "ae154e64-f626-45fb-bd52-840c1c27b2d3",
//     name: "Voldaren Epicure",
//     rarity: "common",
//     oracleText:
//         'When this creature enters, it deals 1 damage to each opponent. Create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")',
//     manaCost: { R: 1 },
//     types: ["Creature"],
//     subtypes: ["Vampire"],
//     power: 1,
//     toughness: 1,
// };

export {};
