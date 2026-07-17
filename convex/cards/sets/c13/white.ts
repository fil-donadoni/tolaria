// c13 — white cards (ADR 0043 colour split).

// TODO(issue #1303 residue audit — Unexpectedly Absent ("Put target nonland
// permanent into its owner's library just beneath the top X cards of that
// library.") needs the `moveZone` Op's `target`-shape to support a
// battlefield permanent moving to the LIBRARY at a chosen position (X, the
// spell's own variable cost). Confirmed absent: the interpreter's `moveZone`
// executor (`convex/gre/effects/interpreter.ts`) only implements `to:
// "hand"` for a `target.type === "permanent"` object ("only the
// bounce-to-hand pair has a plain-move primitive... other destinations from
// the battlefield need leaves-the-battlefield handling and are skipped") —
// no `to: "library"` branch, and no position parameter exists anywhere in
// the Op. Same root gap already tracked for Sunscape Apprentice / Nightscape
// Apprentice ("Put target creature you control on top of its owner's
// library", inv/white.ts + inv/multicolor.ts, item 13 of the #1086
// decomposition); Oust (roe/white.ts) shares it too. Stop-and-issue per
// gre-development.md; tracked-by: #1332.
// export const unexpectedlyAbsent: CardDefinition = {
//     id: "6dff437b-ef68-48f7-afd3-3b72d3c56187",
//     name: "Unexpectedly Absent",
//     rarity: "rare",
//     manaCost: { X: "X", W: 2 },
//     types: ["Instant"],
// };

export {};
