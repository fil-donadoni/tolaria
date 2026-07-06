// FIN — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Vivi Ornitier — {1}{U}{R} Legendary Creature — Wizard. "{0}: Add X mana in
// any combination of {U} and/or {R}, where X is Vivi Ornitier's power.
// Activate only during your turn and only once each turn. / Whenever you
// cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it
// deals 1 damage to each opponent." The second ability is free DSL (CR
// 603.2 SPELL_CAST trigger with an `excludeTypes: "Creature"` filter — the
// exact shape already shipped by Third Path Iconoclast, `bro/multicolor.ts`
// — `counters` + `dealDamage` to `{player: "opponent"}`, both already-
// exercised Ops). BLOCKED on the FIRST ability only: `ActivatedAbility.
// manaAmount` / `getManaChoices` receive a `source: PermanentView` built
// from a raw `CardInstanceState` cast (`getDynamicManaChoices`,
// `convex/gre/constants.ts`) with no `LayerStateView` — `source.power` is
// the BASE power, never the CR 613.4-layered effective power. Vivi's own
// second ability grows her power via +1/+1 counters at runtime, so a mana
// ability reading raw `.power` would silently under-produce mana the moment
// a counter lands. Do not invent a name or paper over the gap with
// `resolve()` (shipping only the trigger and dropping the mana ability
// would also be a partial implementation).
// tracked-by: #927
// export const viviOrnitier: CardDefinition = {
//     id: "ecc1027a-8c07-44a0-bdde-fa2844cff694",
//     name: "Vivi Ornitier",
//     rarity: "mythic",
//     oracleText:
//         "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
//     manaCost: { X: 1, U: 1, R: 1 },
//     supertypes: ["Legendary"],
//     types: ["Creature"],
//     subtypes: ["Wizard"],
//     power: 0,
//     toughness: 3,
// };

export {};
