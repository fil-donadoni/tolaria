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
// STILL BLOCKED on a SEPARATE, already-tracked capability gap: Magda's kit is
// built entirely around Treasure tokens (the tap trigger creates them; the
// tutor cost sacrifices five of them), but `TokenSpec`/`EffectTokenSpec` have
// no field for a token-scoped `activatedAbilities[]` — the same gap that
// blocks vow's Voldaren Epicure (Blood token) as `tracked-by: #778`. Shipping
// Magda's Treasure tokens without their own "{T}, Sacrifice: Add one mana of
// any colour" ability would misrepresent the card (a permanently inert
// Treasure) — same reasoning as the Blood token stub. "Never ship partial"
// keeps the whole card as one unit until #778 lands.
// tracked-by: #778 (was also #897 — filter disjunction now done, see above)
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
