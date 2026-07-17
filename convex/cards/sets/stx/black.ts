// stx — black cards (ADR 0043 colour split).

// Sedgemoor Witch — {2}{B} Creature — Human Warlock, 3/2 (Cube FREE residue
// token-maker, issue #1304). "Menace. Ward—Pay 3 life. Magecraft — Whenever
// you cast or copy an instant or sorcery spell, create a 1/1 black and green
// Pest creature token with 'When this token dies, you gain 1 life.'" Menace
// and Ward are both registered, implemented keywords (data-only), and the
// Magecraft CAST half is a plain `SPELL_CAST` trigger (`spellCastTrigger`,
// the same factory the sibling Witherbloom Apprentice stub in
// `sets/stx/multicolor.ts` cites) — but TWO gaps still block the whole card:
// (1) the Pest token's own "When this token dies, you gain 1 life." is a
// TRIGGERED ability the token carries — `TokenSpec` / `EffectTokenSpec`
// (`convex/cards/types.ts`) have no `triggeredAbilities` field, and
// `createTokenPermanents` (`convex/gre/state.ts`) never registers one even
// for a `resolve()` card, so the Pest token cannot be created AT ALL today
// (tracked-by: #1357 — shared root cause with Pest Infestation's identical
// Pest token, c21/green.ts). (2) EVEN with that gap closed, the "or copy"
// half of Magecraft has no trigger source of its own: `SPELL_CAST` fires
// only on an original cast; `cloneSpellOntoStack` (backing
// `copyStackItem`/`copyResolvingSpell`) emits NO event at all for a spell
// copy. That gap is already tracked at #931 (Witherbloom Apprentice, same
// set) — issue #1304 explicitly authorizes shipping the cast-only half with
// a documented divergence once (1) is unblocked, but (1) alone already
// blocks the whole card today (the token the ability creates doesn't
// exist), so there is nothing partial to ship yet. tracked-by: #1357,
// tracked-by: #931
// export const sedgemoorWitch: CardDefinition = {
//     id: "e900c1eb-968b-4046-b824-c167a7a5b682",
//     name: "Sedgemoor Witch",
//     rarity: "rare",
//     manaCost: { generic: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Warlock"],
//     power: 3,
//     toughness: 2,
// };

export {};
