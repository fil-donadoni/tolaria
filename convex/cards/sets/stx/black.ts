// stx — black cards (ADR 0043 colour split).

// Sedgemoor Witch — {2}{B} Creature — Human Warlock, 3/2 (Cube FREE residue
// token-maker, issue #1304). "Menace. Ward—Pay 3 life. Magecraft — Whenever
// you cast or copy an instant or sorcery spell, create a 1/1 black and green
// Pest creature token with 'When this token dies, you gain 1 life.'" Menace
// and Ward are both registered, implemented keywords (data-only), and the
// Magecraft CAST half is a plain `SPELL_CAST` trigger (`spellCastTrigger`,
// the same factory the sibling Witherbloom Apprentice stub in
// `sets/stx/multicolor.ts` cites). The Pest token itself is no longer a
// blocker: `EffectTokenSpec.triggeredAbilities` shipped (#2364) and Pest
// Infestation (`sets/c21/green.ts`, #2369) is now shipping the shared
// `PEST_TOKEN` spec (`cards/sharedTokens.ts`) this card would reuse
// verbatim. What still blocks the WHOLE card is the "or copy" half of
// Magecraft: `SPELL_CAST` fires only on an original cast;
// `cloneSpellOntoStack` (backing `copyStackItem`/`copyResolvingSpell`) emits
// NO event at all for a spell copy, so there is no trigger source for that
// half. Tracked at #2087 (Witherbloom Apprentice, same set) — issue #1304
// explicitly authorizes shipping the cast-only half with a documented
// divergence, but that is a scope decision for #2087's own PR, not a
// license to reopen it here. tracked-by: #2087
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
