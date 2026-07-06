// clb — red cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

// Delayed Blast Fireball — {1}{R}{R} Instant. "Delayed Blast Fireball deals 2
// damage to each opponent and each creature they control. If this spell was
// cast from exile, it deals 5 damage to each opponent and each creature they
// control instead. Foretell {4}{R}{R}." (CR 702.143 Foretell.) BLOCKED:
// Foretell is `status: "planned"` in `mechanicsRegistry.ts` — no
// foretell-exile-from-hand zone/timing, no later-turn foretell-cost cast
// path, and no "was this spell cast from exile" resolve-time condition. The
// card's own damage amount is conditioned on Foretell, so a partial
// hand-cast-only implementation would misrepresent the oracle text. Do not
// invent a name or paper over the gap with `resolve()`.
// tracked-by: #925
// export const delayedBlastFireball: CardDefinition = {
//     id: "400c76c6-f677-4e7e-87ad-2e526d4b498a",
//     name: "Delayed Blast Fireball",
//     rarity: "rare",
//     oracleText:
//         "Delayed Blast Fireball deals 2 damage to each opponent and each creature they control. If this spell was cast from exile, it deals 5 damage to each opponent and each creature they control instead.\nForetell {4}{R}{R} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
//     manaCost: { X: 1, R: 2 },
//     types: ["Instant"],
// };

export {};
