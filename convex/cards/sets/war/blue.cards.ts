// war — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = the WAR printing).

import { defineCard } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Narset, Parter of Veils — {1}{U}{U} Legendary Planeswalker — Narset,
// starting loyalty 5 (CR 306.5b). Two clauses (issue #1266):
//   • STATIC — "Each opponent can't draw more than one card each turn." This
//     is the SAME CR 614 draw-replacement as Leovold, Emissary of Trest
//     (cn2/multicolor.cards.ts, ADR 0061): an opponent's SECOND-and-later draw each
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
export const narsetParterOfVeils = defineCard(() => ({
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
}));

// ─────────────────────────────────────────────────────────────────────────
// Jace, Wielder of Mysteries — {1}{U}{U}{U} Legendary Planeswalker — Jace,
// starting loyalty 4 (CR 306.5b). Three clauses (issue #3231):
//   • STATIC — "If you would draw a card while your library has no cards in
//     it, you win the game instead." A CR 614.1a draw replacement on the
//     draw seam (ADR 0061), NOT a loss replacement: it fires at the attempted
//     draw, so the replaced draw never happens (CR 614.6) and the CR 704.5b
//     loss is never flagged. Scoped to the controller's own draws, read live
//     from the battlefield — it ends the instant Jace leaves play.
//   • +1 (CR 606) — "Target player mills two cards. Draw a card." Each draw
//     funnels through the seam, so drawing from an empty library under the
//     static wins.
//   • −8 (CR 606) — "Draw seven cards. Then if your library has no cards in
//     it, you win the game." The draws that succeed happen; an eighth-card
//     attempt (a short library) meets the static. The trailing win is a
//     SEPARATE check read after all seven draws (an `if` over the library
//     count), not the replacement.
// hand-tail: If you would draw a card while your library has no cards in it, you win the game instead (#3231)
export const jaceWielderOfMysteries = defineCard(() => ({
    id: "6adb7d73-4482-4930-8497-cffd169b57e2",
    name: "Jace, Wielder of Mysteries",
    rarity: "rare",
    manaCost: { X: 1, U: 3 },
    types: ["Planeswalker"],
    subtypes: ["Jace"],
    supertypes: ["Legendary"],
    loyalty: 4,
    oracleText:
        "If you would draw a card while your library has no cards in it, you win the game instead.\n+1: Target player mills two cards. Draw a card.\n−8: Draw seven cards. Then if your library has no cards in it, you win the game.",
    drawReplacement: {
        id: "jace-wielder-empty-library-win",
        oracleText:
            "If you would draw a card while your library has no cards in it, you win the game instead.",
        applies: (event, source, state) =>
            event.drawingPlayer === source.controllerId &&
            state.players.find((p) => p.id === event.drawingPlayer)
                ?.librarySize === 0,
        outcome: { kind: "win" },
    },
    activatedAbilities: [
        {
            id: "jace-wielder-plus1",
            // CR 606.2 / 606.4 — loyalty ability; `+1` adds one counter.
            cost: { loyalty: 1 },
            useStack: true,
            oracleText: "+1: Target player mills two cards. Draw a card.",
            targetRequirement: { type: "player", count: 1 },
            effects: [
                { op: "mill", player: { target: 0 }, count: 2 },
                { op: "draw", player: "controller", count: 1 },
            ],
        },
        {
            id: "jace-wielder-minus8",
            // CR 606.2 / 606.4 — loyalty ability; `-8` removes eight counters.
            cost: { loyalty: -8 },
            useStack: true,
            oracleText:
                "−8: Draw seven cards. Then if your library has no cards in it, you win the game.",
            effects: [
                { op: "draw", player: "controller", count: 7 },
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: "library",
                                controller: "controller",
                            },
                        },
                        // "no cards in it": a cardinality below one (a
                        // literal comparand is a positive integer).
                        op: "lt",
                        right: 1,
                    },
                    then: [{ op: "winGame", player: "controller" }],
                },
            ],
        },
    ],
}));
