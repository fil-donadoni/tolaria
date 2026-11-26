// Blade LINES (ADR 0186 Decision 9) — see `line.ts`.
//
// Each entry is a course of play the Bot must carry to its end through the
// live Brain path, the opponent's replies between its moves included. A Line
// the Bot cannot follow yet is `stretch`, with its `cause` written.

import type { BladeLine } from "./types";

export const BLADE_LINES: BladeLine[] = [
    {
        label: "line: hold the pump through the upkeep, answer the Shock with it, then let the stack resolve",
        spec: {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Giant Growth", owner: "me", zone: "hand" },
                { name: "Shock", owner: "opp", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "UPKEEP",
            turn: 4,
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            landCount: 0,
            libraryCount: 10,
            life: { me: 20, opp: 20 },
        },
        bot: "me",
        budget: { iterations: 400 },
        seeds: [0xb1ade, 1, 2],
        tier: "must",
        steps: [
            {
                expect: [{ kind: "pass" }],
                replies: [
                    {
                        kind: "cast-spell",
                        card: "Shock",
                        target: "Grizzly Bears",
                    },
                ],
            },
            {
                expect: [
                    {
                        kind: "cast-spell",
                        card: "Giant Growth",
                        target: "Grizzly Bears",
                    },
                ],
            },
            { expect: [{ kind: "pass" }] },
        ],
        note: "Three Bot decisions with the opponent acting between them. In the opponent's upkeep (CR 503.1) nothing threatens the Bears, so the Bot keeps Giant Growth. The opponent then casts Shock at the Bears in its draw step; the Bot answers with the Growth (a 5/5 survives 2 damage, CR 704.5g) and, holding priority with its own spell on top (CR 117.3c), passes so the stack resolves. The last decision has one legal move, so it lowers to an `unconstraining` gap, not a Verdict.",
    },
];
