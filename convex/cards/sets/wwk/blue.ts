// wwk — blue cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = the WWK printing, the
// earliest paper printing per ADR 0041).

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Jace, the Mind Sculptor — {2}{U}{U} Legendary Planeswalker — Jace,
// starting loyalty 3 (CR 306.5b). Vintage Cube FREE wave 3 (issue #1532,
// parent PRD #1525 / planeswalker umbrella #1222). All four loyalty abilities
// (CR 606) are Effect Scripts on the shipped loyalty framework (#700, signed
// `cost.loyalty` derives sorcery-speed / once-per-turn / floor-0):
//   • +2 FATESEAL (CR 701.20) — "Look at the top card of TARGET player's
//     library. You may put that card on the bottom of that player's library."
//     A `scryReorder` (Scry 1 into `library-bottom`) on the TARGET player's
//     library with `chooser: "controller"` (issue #1532): the CONTROLLER makes
//     the top/bottom decision looking at the opponent's library, via the
//     established chooser≠zone-owner seam (`PendingChoice.zoneOwnerId`). The
//     new chooser param earns its dedicated interpreter + wire-format test
//     (per-Op regime) in `convex/gre/effects/__tests__/interpreter.test.ts`.
//   • 0 BRAINSTORM — "Draw three cards, then put two cards from your hand on
//     top of your library in any order." The exact `draw` + `putBack` pair
//     Brainstorm (ice/blue.ts) already exercises; a 0-cost loyalty ability
//     removes/adds no counters.
//   • −1 BOUNCE — "Return target creature to its owner's hand." A `moveZone`
//     of the announced target creature to hand (CR 400.7).
//   • −12 — "Exile all cards from target player's library, then that player
//     shuffles their hand into their library." Composes existing whole-zone
//     `moveZone` Ops (CR 400.7): library→exile (bulk), then hand→library, then
//     an explicit `libraryLook{shuffle}` (a plain `moveZone` into a library
//     does NOT auto-shuffle — the Timetwister composition precedent).
export const jaceTheMindSculptor: CardDefinition = {
    id: "0e606072-a3aa-4300-ba90-ec92a721fa76",
    name: "Jace, the Mind Sculptor",
    rarity: "mythic",
    manaCost: { generic: 2, U: 2 },
    types: ["Planeswalker"],
    subtypes: ["Jace"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        "+2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.\n0: Draw three cards, then put two cards from your hand on top of your library in any order.\n−1: Return target creature to its owner's hand.\n−12: Exile all cards from target player's library, then that player shuffles their hand into their library.",
    activatedAbilities: [
        {
            id: "jace-the-mind-sculptor-plus2",
            // CR 606.2 / 606.5 — loyalty ability; `+2` adds two counters.
            cost: { loyalty: 2 },
            useStack: true,
            oracleText:
                "+2: Look at the top card of target player's library. You may put that card on the bottom of that player's library.",
            // CR 115.1 — "target player" (any player, including the controller).
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    // CR 701.20 fateseal — Scry 1 on the TARGET player's library,
                    // decided by the CONTROLLER (issue #1532 chooser param).
                    op: "scryReorder",
                    player: { target: 0 },
                    chooser: "controller",
                    count: 1,
                    destination: "library-bottom",
                    prompt: "Jace, the Mind Sculptor — you may put the target player's top card on the bottom of their library.",
                },
            ],
        },
        {
            id: "jace-the-mind-sculptor-zero",
            // CR 606.2 — a 0-loyalty ability (adds/removes no counters).
            cost: { loyalty: 0 },
            useStack: true,
            oracleText:
                "0: Draw three cards, then put two cards from your hand on top of your library in any order.",
            effects: [
                { op: "draw", player: "controller", count: 3 },
                {
                    op: "putBack",
                    player: "controller",
                    count: 2,
                    prompt: "Choose two cards to put on top of your library (last picked ends up on top).",
                },
            ],
        },
        {
            id: "jace-the-mind-sculptor-minus1",
            // CR 606.2 / 606.5 — `-1` removes one counter.
            cost: { loyalty: -1 },
            useStack: true,
            oracleText: "−1: Return target creature to its owner's hand.",
            targetRequirement: { type: "Creature", count: 1 },
            // CR 400.7 — bounce the announced target creature to its owner's hand.
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "jace-the-mind-sculptor-minus12",
            // CR 606.2 / 606.5 — `-12` removes twelve counters (the ultimate).
            cost: { loyalty: -12 },
            useStack: true,
            oracleText:
                "−12: Exile all cards from target player's library, then that player shuffles their hand into their library.",
            targetRequirement: { type: "player", count: 1 },
            effects: [
                // CR 400.7 — exile the target player's ENTIRE library (bulk
                // whole-zone move), …
                {
                    op: "moveZone",
                    player: { target: 0 },
                    from: "library",
                    to: "exile",
                },
                // … then move that player's hand into their (now empty) library …
                {
                    op: "moveZone",
                    player: { target: 0 },
                    from: "hand",
                    to: "library",
                },
                // … and shuffle (a plain moveZone does not shuffle — CR 701.20).
                { op: "libraryLook", action: "shuffle", player: { target: 0 } },
            ],
        },
    ],
};
