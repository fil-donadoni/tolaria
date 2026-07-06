// c13 — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

// Toxic Deluge — {2}{B} Sorcery. "As an additional cost to cast this spell,
// pay X life. All creatures get -X/-X until end of turn." (CR 118.4 pay-X-life
// additional cost — already shipped via `additionalCosts.payXLife`, Fire
// Covenant; CR 611.2 temporary P/T reduction — the `pump` Op, forEach/battlefield
// sweep idiom already shipped, Pyroclasm-style.) BLOCKED: the frozen
// `EffectValue` grammar (`{ X: true }`) reads back only the POSITIVE chosen X
// (`SpellContext.getX()`) — there is no negation construct, so `pump` can
// express "+X/+X" but not "-X/-X". Modelling this via permanent "-1/-1"
// counters is NOT an option (the effect is explicitly "until end of turn",
// not permanent). Do not invent a name or paper over the gap with
// `resolve()` (the value-grammar limit is documented precedent for a tracked
// stub — see `EffectCardFilter.manaValueAtMost`'s doc comment for the
// analogous Green Sun's Zenith case).
// tracked-by: #926
// export const toxicDeluge: CardDefinition = {
//     id: "564caf57-4ba5-4993-a35e-945699c94eb7",
//     name: "Toxic Deluge",
//     rarity: "rare",
//     oracleText:
//         "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.",
//     manaCost: { X: 2, B: 1 },
//     types: ["Sorcery"],
//     additionalCosts: { payXLife: true },
// };

export {};
