// wth — black cards (ADR 0043 colour split).

// Doomsday — "Search your library and graveyard for five cards and exile
// the rest. Put the chosen cards on top of your library in any order. You
// lose half your life, rounded up." Blocked on multiple gaps at once: a
// COMBINED library+graveyard search (the `choice` Op's `zone` is a single
// hidden/public zone, not a union of two); "exile the rest" is a mass
// zone-move over everything NOT chosen, which `moveZone` (a
// single-object-or-picks-list Op) doesn't express; "lose half your life,
// rounded up" is a life-total-derived amount with no EffectValue form. The
// PARTIAL top-of-library gap is now closed (issue #1125 — `moveZone`'s
// `to: "library-top"` destination), but that Op moves the picks in a FIXED
// order (the search-choice's own pick order), not the player's SEPARATE
// "in any order" ordering choice Doomsday needs for its five chosen cards —
// still missing. Not a `resolve()` card — each remaining gap is a
// missing-Op stop-and-issue case, not a justified escape hatch.
// tracked-by: #1125
// export const doomsday: CardDefinition = {
//     id: "5b3c6d87-9383-450b-bba5-33435b6b0d08",
//     name: "Doomsday",
//     rarity: "rare",
//     manaCost: { B: 3 },
//     types: ["Sorcery"],
// };

export {};
