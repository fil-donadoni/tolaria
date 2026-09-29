// Fallen Empires (FEM), split by colour per ADR 0043. The 1994 faction-war
// expansion (102 unique cards, 187 prints across its multi-art commons). Every
// in-scope card is a new CardDefinition — FEM has zero reprints of
// already-implemented cards (ADR 0014); its signature multi-artwork commons
// ship as ONE shared CardDefinition plus one CardPrint per extra artwork, all
// setCode "fem", all resolving to the single definition. Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {1}{U} → { X: 1, U: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.
//
// FEM is a mono-colour faction set (no gold cards), so this module is
// intentionally empty — kept for the consistent per-colour shape (ADR 0043).

export {};
