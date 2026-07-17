// KHM — red cards, split by colour per ADR 0043. The registry's
// `import * as khm from "./sets/khm"` resolves through khm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Magda, Brazen Outlaw — "Other Dwarves you control get +1/+0. Whenever a
// Dwarf you control becomes tapped, create a Treasure token. Sacrifice five
// Treasures: Search your library for an artifact or Dragon card, put that
// card onto the battlefield, then shuffle." Issue #897 (the tutor clause's
// "type includes Artifact OR subtype includes Dragon" — a disjunction ACROSS
// two different `EffectCardFilter` dimensions, distinct from the
// OR-WITHIN-one-field array support `type`/`subtype`/`color` already had,
// issue #677) is now SHIPPED: `EffectCardFilter.any` (types.ts / validate.ts
// isCardFilter / interpreter.ts matchesCardFilter) expresses exactly
// `{ any: [{ type: "Artifact" }, { subtype: "Dragon" }] }`.
// #778's blocker (token-scoped `activatedAbilities[]` on `TokenSpec`/
// `EffectTokenSpec` — the same gap that blocked vow's Voldaren Epicure) is
// now SHIPPED (issue #1191, extended by #778 for a `discardFilter` cost leg):
// Magda's Treasure tokens (`TREASURE_TOKEN`, sharedTokens.ts) enter with their
// real "{T}, Sacrifice: Add one mana of any colour" ability, no longer inert.
// STILL BLOCKED on a SEPARATE, narrower gap: the tutor ability's cost is
// "Sacrifice FIVE Treasures", but `ActivatedAbility.cost.sacrificeFilter` is a
// bare `PermanentFilter` — sacrifice exactly ONE matching permanent as a
// cost, no `count`. Unlike `discardFilter` (`{ filter, count }`, issue #901),
// `sacrificeFilter` was never generalized past count=1. "Never ship partial"
// keeps the whole card as one unit until that widening lands.
// tracked-by: #1333 (was #778 — token-ability gap shipped; was also #897 —
// filter disjunction shipped, see above)
// export const magdaBrazenOutlaw: CardDefinition = {
//     id: "079e6263-e54c-4899-a336-5315909b9322",
//     name: "Magda, Brazen Outlaw",
//     rarity: "rare",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Dwarf", "Berserker"],
//     power: 2,
//     toughness: 1,
// };

export {};
