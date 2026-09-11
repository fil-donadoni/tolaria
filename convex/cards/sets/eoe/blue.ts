// EOE — blue cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe"` resolves through eoe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Consult the Star Charts — "Kicker {1}{U}. Look at the top X cards of your
// library, where X is the number of lands you control. Put one of those cards
// into your hand. If this spell was kicked, put two of those cards into your
// hand instead. Put the rest on the bottom of your library in a random order."
// (CR 702.33 Kicker, CR 401.4 dig.) `lookDistribute` looks at `look` = the number of
// lands you control (`count` value) and puts `take` (1, or 2 when kicked) into
// hand, bottoming the rest — one execution path, no new Op. Vintage Cube Kicker
// cluster (issue #692, ADR 0041).
export const consultTheStarCharts: CardDefinition = {
    id: "a16a6555-2e3a-4587-aacd-0307d696b26c",
    rarity: "rare",
    name: "Consult the Star Charts",
    oracleText:
        "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nLook at the top X cards of your library, where X is the number of lands you control. Put one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the rest on the bottom of your library in a random order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{U}",
            mana: { X: 1, U: 1 },
        },
    ],
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                    take: 2,
                },
            ],
            else: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                    take: 1,
                },
            ],
        },
    ],
};

// Quantum Riddler — {3}{U}{U} Creature — Sphinx 4/6 (issue #3294). Three
// clauses, three shapes:
//   • "Flying" — a keyword string (CR 702.9).
//   • "When this creature enters, draw a card." — one Oracle line, therefore
//     exactly ONE TriggeredAbility (CR 603.2), authored as an Effect Script
//     over the `draw` Op (ADR 0045).
//   • "As long as you have one or fewer cards in hand, if you would draw one
//     or more cards, you draw that many cards plus one instead." — a
//     continuous draw replacement on the unified draw seam (CR 614, ADR 0061)
//     with the `modify-count` outcome, this card being its first shipping
//     user. `applies` is the whole condition: the drawing player is THIS
//     card's controller ("you would draw") and that controller's hand is at
//     one or fewer cards, read live off the state view so the clause switches
//     off the instant the hand grows or the Sphinx leaves the battlefield.
//   • "Warp {1}{U}" — the alternative cost + delayed exile (CR 702.185).
//
// COUNT SEMANTICS. CR 121.2a: "An instruction to draw multiple cards can be
// modified by replacement effects that refer to the number of cards drawn.
// This modification occurs before considering any of the individual card
// draws." So "draw 3" with an empty hand is FOUR cards in total, not three
// separate +1 bumps. The seam fires once per card (`requestedCount` carries
// the batch size) and re-plans against live state each iteration, so the first
// card of the instruction takes the bump — 1 + delta = 2 cards — and the hand
// is then at two or more, which switches this card's own condition off for
// every later card of the same instruction. Total: N + 1, the CR answer. The
// agreement is a consequence of THIS card's condition, not of the seam, which
// is why `__tests__/blue.test.ts` asserts the multi-card total explicitly.
// compiler-gap: "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead." (#2693)
// compiler-gap: "Warp {1}{U}" (#2693)
export const quantumRiddler: CardDefinition = {
    id: "120be808-ff3b-4fca-96a1-4db6b9825856",
    rarity: "mythic",
    name: "Quantum Riddler",
    oracleText:
        "Flying\nWhen this creature enters, draw a card.\nAs long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.\nWarp {1}{U}",
    manaCost: { X: 3, U: 2 },
    types: ["Creature"],
    subtypes: ["Sphinx"],
    power: 4,
    toughness: 6,
    staticAbilities: ["flying", "warp"],
    warp: { id: "warp", description: "Warp {1}{U}", mana: { X: 1, U: 1 } },
    triggeredAbilities: [
        enteredTrigger({
            id: "quantum-riddler-etb-draw",
            oracleText: "When this creature enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    drawReplacement: {
        id: "quantum-riddler-draw",
        oracleText:
            "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.",
        // CR 614 — "you would draw" is the controller's own draws only; the
        // hand-size clause reads the controller's LIVE hand off the state view
        // (a static ability of a permanent, so it stops with the permanent).
        applies: (event, source, state) =>
            event.drawingPlayer === source.controllerId &&
            // Fail CLOSED on a controller the view does not carry: a missing
            // player must not read as an empty hand and switch the clause on.
            (state.players.find((p) => p.id === source.controllerId)
                ?.handSize ?? Number.POSITIVE_INFINITY) <= 1,
        outcome: { kind: "modify-count", delta: 1 },
    },
};
