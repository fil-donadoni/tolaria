// war — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = the WAR printing).

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Narset, Parter of Veils — {1}{U}{U} Legendary Planeswalker — Narset,
// starting loyalty 5 (CR 306.5b). Two clauses (issue #1266):
//   • STATIC — "Each opponent can't draw more than one card each turn." This
//     is the SAME CR 614 draw-replacement as Leovold, Emissary of Trest
//     (cn2/multicolor.ts, ADR 0061): an opponent's SECOND-and-later draw each
//     turn (`drawIndexThisTurn >= 1`) is prevented — no card, no draw-from-
//     empty loss. Their first draw (incl. the turn-based draw-step draw) is
//     unaffected. Reused verbatim.
//   • −2 loyalty ability (CR 606) — "Look at the top four cards of your
//     library. You MAY reveal a NONCREATURE, NONLAND card from among them and
//     put it into your hand. Put the rest on the bottom of your library in a
//     RANDOM order." A `lookDistribute` (CR 401.4) with the three refinements
//     added for this card: `filter: { excludeType: ["Creature","Land"] }`
//     (only a noncreature/nonland is hand-eligible), `optional: true` (the
//     "you may"), `randomBottom: true` (the rest bottom unordered + unknown —
//     CR 401.4 random order is unobservable for face-down cards). Reuses only
//     already-exercised structural machinery, so its proof obligation is the
//     catalogue `validateEffectScript` sweep + the auto-generated smoke test;
//     the NEW lookDistribute behavior itself earns its dedicated test in
//     `convex/gre/effects/__tests__/interpreter.test.ts` (the per-Op regime).
export const narsetParterOfVeils: CardDefinition = {
    id: "8c39f9b4-02b9-4d44-b8d6-4fd02ebbb0c5",
    name: "Narset, Parter of Veils",
    rarity: "uncommon",
    manaCost: { X: 1, U: 2 },
    types: ["Planeswalker"],
    subtypes: ["Narset"],
    supertypes: ["Legendary"],
    loyalty: 5,
    oracleText:
        "Each opponent can't draw more than one card each turn.\n−2: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
    // "Each OPPONENT can't draw more than one card each turn" — an opponent's
    // 2nd+ draw (0-based index >= 1) is prevented; their first draw of the turn
    // (incl. their draw-step draw) is unaffected (CR 614, the Leovold seam).
    drawReplacement: {
        id: "narset-draw-lock",
        oracleText: "Each opponent can't draw more than one card each turn.",
        applies: (event, source) =>
            event.drawingPlayer !== source.controllerId &&
            event.drawIndexThisTurn >= 1,
        outcome: { kind: "prevent" },
    },
    activatedAbilities: [
        {
            id: "narset-minus2",
            // CR 606.2 / 606.5 — loyalty ability; `-2` removes two counters.
            cost: { loyalty: -2 },
            useStack: true,
            oracleText:
                "−2: Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 4,
                    take: 1,
                    optional: true,
                    filter: { excludeType: ["Creature", "Land"] },
                    // "LOOK at the top four (privately) ... you may REVEAL a
                    // card ... and put it into your hand" — only the kept card
                    // is public (CR 701.20a); the other three stay hidden as
                    // they go to the random bottom. Hence "kept", not "window".
                    reveal: "kept",
                    randomBottom: true,
                    prompt: "Narset, Parter of Veils — you may put a noncreature, nonland card into your hand.",
                },
            ],
        },
    ],
};
