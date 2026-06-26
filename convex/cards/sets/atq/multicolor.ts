// Antiquities (ATQ) — the game's first artifact-centric expansion, split by
// colour per ADR 0043. Every entry is a new CardDefinition (ATQ has no
// reprints of already-implemented cards, so there are no CardPrint stubs).
// Modern Scryfall oracle text is authoritative (ADR 0004); the canonical
// card list, mana costs, and types are sourced from MTGJSON `ATQ.json`.
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`. Cards are classified by the colour identity of their mana
// cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.
//
// ATQ has no multicolor cards (gold cards debuted in Legends), so this
// module is intentionally empty — kept for the consistent per-colour shape.

export {};
