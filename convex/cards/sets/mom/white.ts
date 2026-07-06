// mom — white cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

// Sunfall — {3}{W}{W} Sorcery. "Exile all creatures. Incubate X, where X is
// the number of creatures exiled this way." (CR 701.13 exile; CR 701.53
// Incubate.) BLOCKED: Incubate is `status: "planned"` in
// `mechanicsRegistry.ts` — no token-transform-on-paid-cost machinery exists,
// and `EffectTokenSpec` has no dynamic-counter-count / token-activated-ability
// fields. Do not invent a name or paper over the gap with `resolve()` (the
// "Op doesn't exist yet" case is stop-and-issue, not the escape hatch).
// tracked-by: #924
// export const sunfall: CardDefinition = {
//     id: "32e29c7d-ed4b-4eff-b3c2-d99e5b63ef8d",
//     name: "Sunfall",
//     rarity: "rare",
//     oracleText:
//         "Exile all creatures. Incubate X, where X is the number of creatures exiled this way.",
//     manaCost: { X: 3, W: 2 },
//     types: ["Sorcery"],
// };

export {};
